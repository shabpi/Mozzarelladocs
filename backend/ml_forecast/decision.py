import os
import sys
import pickle
import pandas as pd
import numpy as np

# Ensure we can import from local directory
lib_dir = os.path.dirname(os.path.abspath(__file__))
if lib_dir not in sys.path:
    sys.path.append(lib_dir)

MAX_TEMP_THRESHOLD = 30
TIME_TO_EVENT_THRESHOLD_H = 6
GOOD_TEMP = 21.0
GOOD_TEMP_BANDWIDTH = 1.0

# Lazy-loaded models
_POWER_DRAW_MODELS = None
_SIMULATOR_MODEL_DATA = None

def _load_power_draw_models():
    global _POWER_DRAW_MODELS
    if _POWER_DRAW_MODELS is None:
        path = os.path.join(os.path.dirname(__file__), "power_draw_models.pkl")
        with open(path, "rb") as f:
            _POWER_DRAW_MODELS = pickle.load(f)
    return _POWER_DRAW_MODELS

class BackendUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if "simulator_model" in module:
            from ml_forecast import simulator_model

            return getattr(simulator_model, name)
        return super().find_class(module, name)

def _load_simulator_model():
    global _SIMULATOR_MODEL_DATA
    if _SIMULATOR_MODEL_DATA is None:
        path = os.path.join(os.path.dirname(__file__), "simulator_model.pkl")
        with open(path, "rb") as f:
            _SIMULATOR_MODEL_DATA = BackendUnpickler(f).load()
    return _SIMULATOR_MODEL_DATA

def _is_heating_season_from_snapshots(feature_data):
    for k, v in feature_data.items():
        if "operation_mode" in k:
            if v == 1.0 or v == "HEAT":
                return True
    return False


def _resolve_heating_season(feature_data, act=None):
    """Prefer explicit override, then planned action, then snapshot operation mode."""
    if "force_heating_season" in feature_data:
        return bool(feature_data["force_heating_season"])
    if act == 1:
        return True
    if act == -1:
        return False
    return _is_heating_season_from_snapshots(feature_data)


def _is_heating_season(feature_data):
    return _resolve_heating_season(feature_data)


def sync_prediction_features(feature_data: dict) -> dict:
    """
    Align inside and return temperature fields the way training data expects
    before running the two-stage ML simulator (returns -> inside).
    """
    fd = dict(feature_data)

    inside = None
    for key in ("last_temp", "status_temperature_in_celsius"):
        value = fd.get(key)
        if value is not None and not (isinstance(value, float) and np.isnan(value)):
            inside = float(value)
            break
    if inside is None:
        inside = 21.0

    fd["last_temp"] = inside
    fd["status_temperature_in_celsius"] = inside

    fallback_return = None
    for d in range(1, 5):
        ret_key = f"device_{d}_status_temperature_return_in_celsius"
        value = fd.get(ret_key)
        if value is not None and not (isinstance(value, float) and np.isnan(value)):
            fallback_return = float(value)
            break
    if fallback_return is None:
        fallback_return = inside - 1.2

    for d in range(1, 5):
        ret_key = f"device_{d}_status_temperature_return_in_celsius"
        value = fd.get(ret_key)
        if value is None or (isinstance(value, float) and np.isnan(value)):
            fd[ret_key] = float(fallback_return)
        else:
            fd[ret_key] = float(value)

    return fd

def _wrap_model_if_needed(model):
    if hasattr(model, "predict") and not hasattr(model, "feature_means"):
        # Raw SimulatorModel instance passed
        sim_data = _load_simulator_model()
        sim_data_copy = sim_data.copy()
        sim_data_copy["model"] = model
        return BackendSimulatorWrapper(sim_data_copy)
    elif isinstance(model, dict) and "model" in model:
        # Loaded metadata dictionary passed
        return BackendSimulatorWrapper(model)
    else:
        # Already wrapped or matches wrapper interface
        return model

class BackendSimulatorWrapper:
    def __init__(self, simulator_data):
        self.model = simulator_data["model"]
        self.feature_means = simulator_data["feature_means"]
        self.feature_stds = simulator_data["feature_stds"]
        self.feature_names = simulator_data["feature_names"]
        self.meta_h = simulator_data["meta_h"]
        self.meta_c = simulator_data["meta_c"]
        self.lags = simulator_data["lags"]

    def predict(self, feature_data):
        forecasts, _ = self._run_predict(feature_data)
        return forecasts

    def _run_predict(self, feature_data):
        feature_data = sync_prediction_features(feature_data)
        is_heating = _is_heating_season(feature_data)
        meta = self.meta_h if is_heating else self.meta_c
        
        # Get power draw forecast from feature_data
        power_draw_forecast = feature_data.get("power_draw", {})
        horizon = len(power_draw_forecast.get("device_1", []))
        if horizon == 0:
            return [], {}

        forecasts = []
        
        # Initialize return temperature memory from current device readings
        initial_ret = {}
        for d in range(1, 5):
            device_name = f"device_{d}"
            initial_ret[device_name] = float(
                feature_data.get(f"{device_name}_status_temperature_return_in_celsius", 20.0)
            )
        
        # Create timestamps for the forecast steps
        start_ts = pd.Timestamp.now()
        ts_list = [start_ts + pd.Timedelta(minutes=30 * t) for t in range(horizon)]
        
        # Inside temp seeds target_lag1 (room temperature history)
        last_temp = float(feature_data.get("last_temp", feature_data.get("status_temperature_in_celsius", 21.0)))
        
        # Setup memory df_return_gt — stage 1 return-temp chain
        all_indices = [start_ts - pd.Timedelta(minutes=30)] + ts_list
        df_ret_gt = pd.DataFrame(index=all_indices, columns=[
            f"device_{d}_status_temperature_return_in_celsius" for d in range(1, 5)
        ])
        for d in range(1, 5):
            col = f"device_{d}_status_temperature_return_in_celsius"
            df_ret_gt.loc[all_indices[0], col] = float(initial_ret[f"device_{d}"])
            
        self.model.df_return_gt = df_ret_gt
        self.model._cached_is_heating_df = pd.Series([is_heating] * (horizon + 1), index=all_indices)
        
        room_temp_history = [last_temp]
        
        for t in range(horizon):
            ts = ts_list[t]
            
            # Construct raw input row for this step
            raw_row = {}
            for d in range(1, 5):
                device_name = f"device_{d}"
                raw_row[f"{device_name}_status_temperature_outside_in_celsius"] = float(feature_data.get(
                    f"{device_name}_status_temperature_outside_in_celsius", 10.0
                ))
                raw_row[f"{device_name}_power_draw_kw"] = float(power_draw_forecast[device_name][t])
                
            if self.lags > 0:
                for col in list(raw_row.keys()):
                    if t == 0:
                        raw_row[f"{col}_lag1"] = float(feature_data.get(col, raw_row[col]))
                    else:
                        if "outside" in col:
                            raw_row[f"{col}_lag1"] = float(feature_data.get(col, raw_row[col]))
                        else:
                            raw_row[f"{col}_lag1"] = float(
                                power_draw_forecast[col.replace("_power_draw_kw", "")][t - 1]
                            )
                
                # Previous inside temp — matches training target_lag1
                raw_row["target_lag1"] = float(room_temp_history[-1])
                
            row_df = pd.DataFrame([raw_row], index=[ts])
            row_df = row_df[self.feature_names]
            means = pd.Series(meta["mean"])[self.feature_names]
            stds = pd.Series(meta["std"])[self.feature_names]
            row_df_norm = (row_df - means) / stds
            
            # Stage 1: predict return temperatures
            ret_pred = self.model._predict_device_returns(row_df_norm)
            ret_pred_cols = {
                f"device_{d}": f"device_{d}_status_temperature_return_in_celsius" for d in range(1, 5)
            }
            ret_pred = ret_pred.rename(columns=ret_pred_cols)
            self.model.df_return_gt.loc[ts] = ret_pred.iloc[0]
            
            # Stage 2: predict inside (room) temperature
            pred_temp = self.model.predict(row_df_norm)[0]
            
            forecasts.append(pred_temp)
            room_temp_history.append(pred_temp)

        final_return_temps = {}
        if self.model.df_return_gt is not None and len(self.model.df_return_gt):
            last_row = self.model.df_return_gt.iloc[-1]
            for d in range(1, 5):
                col = f"device_{d}_status_temperature_return_in_celsius"
                final_return_temps[d] = float(last_row[col])

        return forecasts, final_return_temps

def calc_power_draw_from_plan(current_time, hrs_to_event, plan, feature_data=None):
    if feature_data is None:
        feature_data = {
            "device_1_status_operation_mode": 1.0,
            "device_1_power_draw_kw": 0.0,
            "device_2_power_draw_kw": 0.0,
            "device_3_power_draw_kw": 0.0,
            "device_4_power_draw_kw": 0.0,
        }
        
    power_draw_models = _load_power_draw_models()
    default_heating = _resolve_heating_season(feature_data)
    
    device_power_draws = {f"device_{d}": [] for d in range(1, 5)}
    total_power_draw = []
    
    last_power = {}
    for d in range(1, 5):
        device_name = f"device_{d}"
        last_power[device_name] = float(feature_data.get(f"{device_name}_power_draw_kw", 0.0))
        
    horizon = len(plan)
    for t in range(horizon):
        act = plan[t]
        step_heating = _resolve_heating_season(feature_data, act=act)
        status_is_compressor_active = 1.0 if act != 0 else 0.0
        status_operation_mode = 1.0 if act == 1 else (0.0 if act == -1 else (1.0 if default_heating else 0.0))
        
        step_total = 0.0
        for d in range(1, 5):
            device_name = f"device_{d}"
            df_in = pd.DataFrame([{
                "status_is_compressor_active": status_is_compressor_active,
                "status_operation_mode": status_operation_mode,
                "power_draw_kw_lag1": last_power[device_name]
            }])
            
            model = power_draw_models[device_name]["heating" if step_heating else "cooling"]
            pred = model.predict(df_in)[0]
            pred = max(0.0, float(pred))
            
            device_power_draws[device_name].append(pred)
            last_power[device_name] = pred
            step_total += pred
            
        total_power_draw.append(step_total)
        
    device_power_draws["total"] = total_power_draw
    return device_power_draws


def predict_room_temps(model, feature_data, plan, *, force_heating_season=None):
    """Run the ML room-temperature model for a plan (30-min steps)."""
    inside, _ = predict_room_and_return_temps(
        model,
        feature_data,
        plan,
        force_heating_season=force_heating_season,
    )
    return inside


def predict_room_and_return_temps(model, feature_data, plan, *, force_heating_season=None):
    """
    Run the two-stage ML simulator after syncing inside/return temps.
    Returns (inside_temps, return_temps_by_device) where return_temps maps 1..4 -> °C.
    """
    model = _wrap_model_if_needed(model)
    fd_copy = sync_prediction_features(feature_data)
    if force_heating_season is not None:
        fd_copy["force_heating_season"] = bool(force_heating_season)
    power_draw = calc_power_draw_from_plan(None, None, plan, fd_copy)
    fd_copy["power_draw"] = power_draw

    if hasattr(model, "_run_predict"):
        return model._run_predict(fd_copy)

    inside = model.predict(fd_copy)
    return inside, {}


def check_plan_deviation(current_time, feature_data, hrs_to_event, plan, model):
    model = _wrap_model_if_needed(model)
    
    # 30min intervals
    steps_per_hour = 2
    steps_to_event = int(hrs_to_event * steps_per_hour) if hrs_to_event is not None else 0
    
    full_plan = plan.copy()
    if hrs_to_event is not None and len(full_plan) < steps_to_event:
        full_plan.extend([0] * (steps_to_event - len(full_plan)))
        
    fd_copy = sync_prediction_features(feature_data)
    
    # Predict device power draws for the plan
    power_draw = calc_power_draw_from_plan(current_time, hrs_to_event, full_plan, fd_copy)
    fd_copy.update({"power_draw": power_draw})
    
    # Predict room temperatures
    forecasts = model.predict(fd_copy)
    
    if hrs_to_event is not None and steps_to_event > 0 and len(forecasts) >= steps_to_event:
        deviation = forecasts[steps_to_event - 1] - GOOD_TEMP
    else:
        deviation = 0.0
        
    return deviation, forecasts

def decide(current_time, feature_data, hrs_to_event, model, forecast_horizon: int, interval="30min"):
    """
    Decide whether to cool, heat, or do nothing.
    Decide based on feature_data and hrs_to_event.
    Return plan array and forecasts.
    """
    steps_per_hour = 2 if interval in ["30min", "30m"] else 1
    model = _wrap_model_if_needed(model)
    
    last_temp = sync_prediction_features(feature_data)["last_temp"]

    cur_plan = [0] * forecast_horizon
    do_nothing_deviation, do_nothing_forecast = check_plan_deviation(current_time, feature_data, hrs_to_event, cur_plan, model)

    if hrs_to_event == None:
        # No event scheduled, do nothing
        return cur_plan, do_nothing_forecast
    
    steps_to_event = int(hrs_to_event * steps_per_hour)
    time_to_event_threshold_steps = TIME_TO_EVENT_THRESHOLD_H * steps_per_hour
    
    if steps_to_event > time_to_event_threshold_steps:
        # Next event is too far, do nothing
        return cur_plan, do_nothing_forecast

    fixed = [False] * len(cur_plan)
    # check for fixed action by checking for emergency and possible do nothings
    for check_fixed_step in range(1, steps_to_event + 1):
        if check_fixed_step > len(cur_plan):
            break
        plan = cur_plan[:check_fixed_step]
        deviation, forecast = check_plan_deviation(current_time, feature_data, hrs_to_event, plan, model)

        if steps_to_event - check_fixed_step <= 0:
            # Event is currently active
            if abs(last_temp - GOOD_TEMP) < GOOD_TEMP_BANDWIDTH:
                cur_plan[check_fixed_step-1] = 0
            elif last_temp < GOOD_TEMP - GOOD_TEMP_BANDWIDTH:
                cur_plan[check_fixed_step-1] = 1
            else:
                cur_plan[check_fixed_step-1] = -1
            fixed[check_fixed_step-1] = True
            continue

        if last_temp >= MAX_TEMP_THRESHOLD:
            # Emergency cool down
            cur_plan[check_fixed_step-1] = -1
            fixed[check_fixed_step-1] = True
            continue

        if abs(deviation) > GOOD_TEMP_BANDWIDTH:
            # we need to do something
            break

        # its fine if we do nothing this step
        fixed[check_fixed_step-1] = True

    # update forecast
    deviation, forecast = check_plan_deviation(current_time, feature_data, hrs_to_event, cur_plan, model)

    last_fixed = 0
    for step, fixed_action in enumerate(fixed):
        if fixed_action:
            last_fixed = step + 1
    if last_fixed == forecast_horizon:
        # all actions are fixed, return them
        return cur_plan, forecast

    # check whether we have to heat or cool with current forecast of fixed actions
    act = 0
    if deviation > GOOD_TEMP_BANDWIDTH:
        act = -1
    elif deviation < -GOOD_TEMP_BANDWIDTH:
        act = 1

    if act == 0:
        # this means we are in the bandwidth with the current plan
        return cur_plan, forecast

    # if we are here then there is an event soon and we must check when we need to start heating/cooling
    # we want to start as late as possible, so start from the back and predict forecasts for possible plans
    for step in range(steps_to_event - 1, last_fixed - 1, -1):
        if step >= len(cur_plan):
            continue
        cur_plan[step] = act
        deviation, forecast = check_plan_deviation(current_time, feature_data, hrs_to_event, cur_plan, model)
        if abs(deviation) < GOOD_TEMP_BANDWIDTH:
            return cur_plan, forecast
    
    return cur_plan, forecast