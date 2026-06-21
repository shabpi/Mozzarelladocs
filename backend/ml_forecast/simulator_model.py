import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.optimize import minimize
from sklearn.linear_model import LinearRegression


def get_data(*args, **kwargs):
    raise NotImplementedError("get_data is only used for offline model training")

def predict_autoregressive(model, X_test, predict_fn, lags, mean_target, std_target):
    """
    Predict step-by-step autoregressively using past predictions as lagged features.
    """
    if lags <= 0:
        return predict_fn(model, X_test)
        
    X_test_copy = X_test.copy()
    preds = np.zeros(len(X_test_copy))
    
    for i in range(len(X_test_copy)):
        for j in range(1, lags + 1):
            lag_col_name = f"target_lag{j}"
            if lag_col_name in X_test_copy.columns:
                lag_col_idx = X_test_copy.columns.get_loc(lag_col_name)
                if i - j >= 0:
                    past_pred = preds[i - j]
                    # Normalize using correct mean and std for target_lag{j}
                    m = mean_target[lag_col_name] if isinstance(mean_target, dict) else mean_target
                    s = std_target[lag_col_name] if isinstance(std_target, dict) else std_target
                    normalized_past_pred = (past_pred - m) / s
                    X_test_copy.iloc[i, lag_col_idx] = normalized_past_pred
            
        row_df = X_test_copy.iloc[[i]]
        preds[i] = predict_fn(model, row_df)[0]
        
    return preds

class LinearFullSimulatorFunction:
    """
    Predict target temperature from return temperatures and outside temperatures of the 4 devices.
    If lags > 0: Delta T = sum_d (w_d_ret * T_ret_d) + sum_d (w_d_out * T_out_d) + w_lag * T_lag + bias  (10 parameters)
    If lags = 0: T_pred = sum_d (w_d_ret * T_ret_d) + sum_d (w_d_out * T_out_d) + bias                   (9 parameters)
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.num_params = 10 if has_lag else 9

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params):
        if self.has_lag:
            w_ret = params[:4]
            w_out = params[4:8]
            w_lag = params[8]
            bias = params[9]
            return np.dot(T_ret, w_ret) + np.dot(T_out, w_out) + w_lag * T_lag_norm + bias
        else:
            w_ret = params[:4]
            w_out = params[4:8]
            bias = params[8]
            return np.dot(T_ret, w_ret) + np.dot(T_out, w_out) + bias


class AverageReturnsSimulatorFunction:
    """
    Predict target temperature from the average return temperature and average outside temperature.
    If lags > 0: Delta T = w_ret * Mean(T_ret) + w_out * Mean(T_out) + w_lag * T_lag + bias  (4 parameters)
    If lags = 0: T_pred = w_ret * Mean(T_ret) + w_out * Mean(T_out) + bias                   (3 parameters)
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.num_params = 4 if has_lag else 3

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params):
        T_ret_mean = np.mean(T_ret, axis=1)
        T_out_mean = np.mean(T_out, axis=1)
        if self.has_lag:
            w_ret, w_out, w_lag, bias = params
            return w_ret * T_ret_mean + w_out * T_out_mean + w_lag * T_lag_norm + bias
        else:
            w_ret, w_out, bias = params
            return w_ret * T_ret_mean + w_out * T_out_mean + bias


class HeatExchangeSimulatorFunction:
    """
    Physics-inspired heat exchange model (Newton's Law of Cooling/Heating).
    If lags > 0: Delta T = w_exchange * (Mean(T_ret) - T_lag_raw) + w_out * (Mean(T_out) - T_lag_raw) + bias (3 parameters)
    If lags = 0: T_pred = w_ret * Mean(T_ret) + w_out * Mean(T_out) + bias                                  (3 parameters)
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.num_params = 3

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params):
        T_ret_mean = np.mean(T_ret, axis=1)
        T_out_mean = np.mean(T_out, axis=1)
        if self.has_lag and T_lag_raw is not None:
            w_exchange, w_out, bias = params
            return w_exchange * (T_ret_mean - T_lag_raw) + w_out * (T_out_mean - T_lag_raw) + bias
        else:
            w_ret, w_out, bias = params
            return w_ret * T_ret_mean + w_out * T_out_mean + bias


class PolynomialAverageReturnsSimulatorFunction:
    """
    Predict target temperature from a quadratic polynomial of average return temperature,
    average outside temperature, and (optionally) lag.
    
    If lags > 0:
      Inputs: x1 = Mean(T_ret)_norm, x2 = Mean(T_out), x3 = T_lag_norm
      Terms: 1, x1, x2, x3, x1^2, x2^2, x3^2, x1*x2, x1*x3, x2*x3 (10 parameters)
    If lags = 0:
      Inputs: x1 = Mean(T_ret)_norm, x2 = Mean(T_out)
      Terms: 1, x1, x2, x1^2, x2^2, x1*x2 (6 parameters)
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.num_params = 10 if has_lag else 6
        self.ret_mean = 0.0
        self.ret_std = 1.0

    def fit_normalization(self, T_ret, T_out):
        mean_ret = np.mean(T_ret, axis=1)
        self.ret_mean = np.mean(mean_ret)
        self.ret_std = np.std(mean_ret)
        if self.ret_std == 0:
            self.ret_std = 1.0

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params):
        x1_raw = np.mean(T_ret, axis=1)
        x1 = (x1_raw - self.ret_mean) / self.ret_std
        x2 = np.mean(T_out, axis=1)
        if self.has_lag:
            x3 = T_lag_norm
            return (params[0] +
                    params[1] * x1 +
                    params[2] * x2 +
                    params[3] * x3 +
                    params[4] * (x1 ** 2) +
                    params[5] * (x2 ** 2) +
                    params[6] * (x3 ** 2) +
                    params[7] * (x1 * x2) +
                    params[8] * (x1 * x3) +
                    params[9] * (x2 * x3))
        else:
            return (params[0] +
                    params[1] * x1 +
                    params[2] * x2 +
                    params[3] * (x1 ** 2) +
                    params[4] * (x2 ** 2) +
                    params[5] * (x1 * x2))


class PolynomialFullSimulatorFunction:
    """
    Predict target temperature from a quadratic polynomial of all individual returns,
    outside temperatures, and lag.
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.num_params = 25 if has_lag else 21
        self.ret_mean = np.zeros(4)
        self.ret_std = np.ones(4)

    def fit_normalization(self, T_ret, T_out):
        self.ret_mean = np.mean(T_ret, axis=0)
        self.ret_std = np.std(T_ret, axis=0)
        self.ret_std[self.ret_std == 0] = 1.0

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params):
        T_ret_norm = (T_ret - self.ret_mean) / self.ret_std
        
        # Bias
        val = params[0]
        
        # Linear terms: params[1:5] for ret, params[5:9] for out
        val = val + np.dot(T_ret_norm, params[1:5]) + np.dot(T_out, params[5:9])
        
        # Quadratic terms: params[9:13] for ret^2, params[13:17] for out^2
        val = val + np.dot(T_ret_norm ** 2, params[9:13]) + np.dot(T_out ** 2, params[13:17])
        
        # Device interactions: T_ret_norm[:, d] * T_out[:, d]
        # params[17:21]
        device_inter = T_ret_norm * T_out
        val = val + np.dot(device_inter, params[17:21])
        
        if self.has_lag:
            # params[21]: lag
            # params[22]: lag^2
            # params[23]: lag * mean_ret
            # params[24]: lag * mean_out
            mean_ret_norm = np.mean(T_ret_norm, axis=1)
            mean_out = np.mean(T_out, axis=1)
            val = val + params[21] * T_lag_norm
            val = val + params[22] * (T_lag_norm ** 2)
            val = val + params[23] * (T_lag_norm * mean_ret_norm)
            val = val + params[24] * (T_lag_norm * mean_out)
            
        return val


class XGBoostSimulatorFunction:
    """
    Predict temperature using an XGBoost Regressor.
    Conforms to the simulator function interface.
    """
    def __init__(self, has_lag=True):
        self.has_lag = has_lag
        self.model = None
        self.num_params = 0

    def fit(self, T_ret, T_out, T_lag_norm, T_lag_raw, y):
        features = [T_ret, T_out]
        if self.has_lag and T_lag_norm is not None:
            features.append(T_lag_norm[:, np.newaxis])
        X_xgb = np.hstack(features)
        
        # Train XGBoost regressor
        self.model = xgb.XGBRegressor(
            n_estimators=50,
            learning_rate=0.1,
            max_depth=3,
            random_state=42,
            reg_lambda=0.1,
        )
        
        if self.has_lag and T_lag_raw is not None:
            target = y - T_lag_raw
        else:
            target = y
            
        self.model.fit(X_xgb, target)

    def evaluate(self, T_ret, T_out, T_lag_norm, T_lag_raw, params=None):
        features = [T_ret, T_out]
        if self.has_lag and T_lag_norm is not None:
            features.append(T_lag_norm[:, np.newaxis])
        X_xgb = np.hstack(features)
        return self.model.predict(X_xgb)


def get_target_function(func_type, has_lag):
    if func_type == "linear_full":
        return LinearFullSimulatorFunction(has_lag=has_lag)
    elif func_type == "linear_average_returns":
        return AverageReturnsSimulatorFunction(has_lag=has_lag)
    elif func_type == "heat_exchange":
        return HeatExchangeSimulatorFunction(has_lag=has_lag)
    elif func_type == "polynomial_average_returns":
        return PolynomialAverageReturnsSimulatorFunction(has_lag=has_lag)
    elif func_type == "polynomial_full":
        return PolynomialFullSimulatorFunction(has_lag=has_lag)
    elif func_type == "xgboost":
        return XGBoostSimulatorFunction(has_lag=has_lag)
    else:
        raise ValueError(f"Unknown target function type: {func_type}")


def loss_fn(params, func, T_ret, T_out, T_lag_raw, T_lag_norm, y_true):
    """
    Calculates Mean Squared Error (MSE) for optimization.
    """
    if T_lag_raw is not None:
        delta_T = func.evaluate(T_ret, T_out, T_lag_norm, T_lag_raw, params)
        y_pred = T_lag_raw + delta_T
    else:
        y_pred = func.evaluate(T_ret, T_out, None, None, params)
    
    return np.mean((y_true - y_pred) ** 2)


class ConstantOffsetModel:
    def __init__(self, offset):
        self.offset = offset
    def predict(self, X_device):
        return X_device + self.offset


class SimulatorModel:
    """
    Custom Simulator Model that learns distinct parameterized functions
    for heating and cooling operational modes.
    """
    def __init__(self, heat_func, cool_func, device_func_type="linear", lags=2):
        self.heat_func = heat_func
        self.cool_func = cool_func
        self.device_func_type = device_func_type
        self.lags = lags
        
        self.heat_params = None
        self.cool_params = None
        
        # Values for un-normalizing the target lag column
        self.mean_y_heat = 0.0
        self.std_y_heat = 1.0
        self.mean_y_cool = 0.0
        self.std_y_cool = 1.0

        # Dictionaries to store fitted models for return temperatures of each device per mode
        self.device_models_heat = {}
        self.device_models_cool = {}
        
        # Check if device_func_type is a simulator function type
        self.device_funcs_is_simulator = self.device_func_type in [
            "linear_full", "linear_average_returns", "heat_exchange", 
            "polynomial_average_returns", "polynomial_full", "xgboost"
        ]
        
        self.device_heat_funcs = {}
        self.device_cool_funcs = {}
        self.device_heat_params = {}
        self.device_cool_params = {}
        
        self.mean_ret_heat = {}
        self.std_ret_heat = {}
        self.mean_ret_cool = {}
        self.std_ret_cool = {}
        
        if self.device_funcs_is_simulator:
            has_lag = self.lags > 0
            for d in range(1, 5):
                device_name = f"device_{d}"
                self.device_heat_funcs[device_name] = get_target_function(self.device_func_type, has_lag=has_lag)
                self.device_cool_funcs[device_name] = get_target_function(self.device_func_type, has_lag=has_lag)
        
        # Combined DataFrame of ground truth return temperatures
        self.df_return_gt = None
        # Cache for raw outside temperatures
        self._cached_outside_raw = None
        # Cache for operation mode lookup
        self._cached_is_heating_df = None

    def _get_is_heating(self, X):
        if self._cached_is_heating_df is not None:
            return self._cached_is_heating_df.reindex(X.index).ffill().bfill()
            
        time_diff = None
        for i in range(len(X) - 1):
            diff = X.index[i+1] - X.index[i]
            if 0 < diff.total_seconds() < 86400:
                time_diff = diff
                break
        if time_diff is None:
            time_diff = pd.Timedelta(minutes=30)
        minutes = int(round(time_diff.total_seconds() / 60.0))
        interval = f"{minutes}min"

        data_heating = get_data(interval=interval, mode="heating")
        data_cooling = get_data(interval=interval, mode="cooling")

        df_heating_op = pd.DataFrame({
            f"device_{d}_status_operation_mode": data_heating[f"device_{d}_status_operation_mode"]
            for d in range(1, 5)
        })
        df_cooling_op = pd.DataFrame({
            f"device_{d}_status_operation_mode": data_cooling[f"device_{d}_status_operation_mode"]
            for d in range(1, 5)
        })
        df_op = pd.concat([df_heating_op, df_cooling_op])
        
        self._cached_is_heating_df = df_op.mean(axis=1) > 0.5
        return self._cached_is_heating_df.reindex(X.index).ffill().bfill()


    def _get_return_gt(self, X):
        if self.df_return_gt is not None:
            return self.df_return_gt.reindex(X.index).ffill().bfill()
            
        time_diff = None
        for i in range(len(X) - 1):
            diff = X.index[i+1] - X.index[i]
            if 0 < diff.total_seconds() < 86400:
                time_diff = diff
                break
        if time_diff is None:
            time_diff = pd.Timedelta(minutes=30)
        minutes = int(round(time_diff.total_seconds() / 60.0))
        interval = f"{minutes}min"

        data_heating = get_data(interval=interval, mode="heating")
        data_cooling = get_data(interval=interval, mode="cooling")

        df_heating_ret = pd.DataFrame({
            f"device_{d}_status_temperature_return_in_celsius": data_heating[f"device_{d}_status_temperature_return_in_celsius"]
            for d in range(1, 5)
        })
        df_cooling_ret = pd.DataFrame({
            f"device_{d}_status_temperature_return_in_celsius": data_cooling[f"device_{d}_status_temperature_return_in_celsius"]
            for d in range(1, 5)
        })
        self.df_return_gt = pd.concat([df_heating_ret, df_cooling_ret])
        return self.df_return_gt.reindex(X.index).ffill().bfill()

    def _get_raw_outside_temps(self, X):
        if self._cached_outside_raw is not None:
            return self._cached_outside_raw.reindex(X.index).ffill().bfill()
            
        time_diff = None
        for i in range(len(X) - 1):
            diff = X.index[i+1] - X.index[i]
            if 0 < diff.total_seconds() < 86400:
                time_diff = diff
                break
        if time_diff is None:
            time_diff = pd.Timedelta(minutes=30)
        minutes = int(round(time_diff.total_seconds() / 60.0))
        interval = f"{minutes}min"

        data_heating = get_data(interval=interval, mode="heating")
        data_cooling = get_data(interval=interval, mode="cooling")

        df_heating_out = pd.DataFrame({
            f"device_{d}_status_temperature_outside_in_celsius": data_heating[f"device_{d}_status_temperature_outside_in_celsius"]
            for d in range(1, 5)
        })
        df_cooling_out = pd.DataFrame({
            f"device_{d}_status_temperature_outside_in_celsius": data_cooling[f"device_{d}_status_temperature_outside_in_celsius"]
            for d in range(1, 5)
        })
        self._cached_outside_raw = pd.concat([df_heating_out, df_cooling_out])
        return self._cached_outside_raw.reindex(X.index).ffill().bfill()

    def fit(self, X, y):
        # Determine heating vs cooling rows by operation mode
        is_heating = self._get_is_heating(X)
        
        # Save target mean and standard deviation for heating
        if is_heating.any():
            self.mean_y_heat = y[is_heating].mean()
            self.std_y_heat = y[is_heating].std()
            if pd.isna(self.std_y_heat) or self.std_y_heat == 0:
                self.std_y_heat = 1.0
        
        # Save target mean and standard deviation for cooling
        if (~is_heating).any():
            self.mean_y_cool = y[~is_heating].mean()
            self.std_y_cool = y[~is_heating].std()
            if pd.isna(self.std_y_cool) or self.std_y_cool == 0:
                self.std_y_cool = 1.0

        # Step 1: Fit return temperature models for each device
        # Cache data sources
        self._get_return_gt(X)
        self._get_raw_outside_temps(X)

        if self.device_func_type == "constant_offset":
            df_outside_raw = self._get_raw_outside_temps(X)

        for d in range(1, 5):
            device_name = f"device_{d}"
            y_device = self.df_return_gt.loc[X.index, f"{device_name}_status_temperature_return_in_celsius"].values
            
            # Save target mean and standard deviation for heating return temp
            if is_heating.any():
                y_device_h = y_device[is_heating]
                self.mean_ret_heat[device_name] = y_device_h.mean()
                self.std_ret_heat[device_name] = y_device_h.std()
                if pd.isna(self.std_ret_heat[device_name]) or self.std_ret_heat[device_name] == 0:
                    self.std_ret_heat[device_name] = 1.0
            
            # Save target mean and standard deviation for cooling return temp
            if (~is_heating).any():
                y_device_c = y_device[~is_heating]
                self.mean_ret_cool[device_name] = y_device_c.mean()
                self.std_ret_cool[device_name] = y_device_c.std()
                if pd.isna(self.std_ret_cool[device_name]) or self.std_ret_cool[device_name] == 0:
                    self.std_ret_cool[device_name] = 1.0

            # --- Fit Heating Device Return Model ---
            if is_heating.any():
                y_device_h = y_device[is_heating]
                X_h = X[is_heating]
                if self.device_funcs_is_simulator:
                    T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev = self._extract_device_features(X_h, device_name, mode="heating")
                    if hasattr(self.device_heat_funcs[device_name], "fit"):
                        self.device_heat_funcs[device_name].fit(T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev, y_device_h)
                        self.device_heat_params[device_name] = None
                    else:
                        if hasattr(self.device_heat_funcs[device_name], "fit_normalization"):
                            self.device_heat_funcs[device_name].fit_normalization(T_ret_dev, T_out_dev)
                        init_guess = np.zeros(self.device_heat_funcs[device_name].num_params)
                        res = minimize(
                            loss_fn,
                            init_guess,
                            args=(self.device_heat_funcs[device_name], T_ret_dev, T_out_dev, T_lag_raw_dev, T_lag_norm_dev, y_device_h),
                            method="L-BFGS-B"
                        )
                        self.device_heat_params[device_name] = res.x
                        print(f"Optimized {device_name} Heating Parameters: {res.x}")
                elif self.device_func_type == "linear":
                    cols = [
                        f"{device_name}_status_temperature_outside_in_celsius",
                        f"{device_name}_power_draw_kw"
                    ]
                    X_device = X_h[cols]
                    model_d = LinearRegression()
                    model_d.fit(X_device, y_device_h)
                    self.device_models_heat[device_name] = model_d
                elif self.device_func_type == "simple_linear":
                    cols = [f"{device_name}_status_temperature_outside_in_celsius"]
                    X_device = X_h[cols]
                    model_d = LinearRegression()
                    model_d.fit(X_device, y_device_h)
                    self.device_models_heat[device_name] = model_d
                elif self.device_func_type == "constant_offset":
                    t_outside = df_outside_raw.loc[X_h.index, f"{device_name}_status_temperature_outside_in_celsius"].values
                    offset = np.mean(y_device_h - t_outside)
                    self.device_models_heat[device_name] = ConstantOffsetModel(offset)

            # --- Fit Cooling Device Return Model ---
            if (~is_heating).any():
                y_device_c = y_device[~is_heating]
                X_c = X[~is_heating]
                if self.device_funcs_is_simulator:
                    T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev = self._extract_device_features(X_c, device_name, mode="cooling")
                    if hasattr(self.device_cool_funcs[device_name], "fit"):
                        self.device_cool_funcs[device_name].fit(T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev, y_device_c)
                        self.device_cool_params[device_name] = None
                    else:
                        if hasattr(self.device_cool_funcs[device_name], "fit_normalization"):
                            self.device_cool_funcs[device_name].fit_normalization(T_ret_dev, T_out_dev)
                        init_guess = np.zeros(self.device_cool_funcs[device_name].num_params)
                        res = minimize(
                            loss_fn,
                            init_guess,
                            args=(self.device_cool_funcs[device_name], T_ret_dev, T_out_dev, T_lag_raw_dev, T_lag_norm_dev, y_device_c),
                            method="L-BFGS-B"
                        )
                        self.device_cool_params[device_name] = res.x
                        print(f"Optimized {device_name} Cooling Parameters: {res.x}")
                elif self.device_func_type == "linear":
                    cols = [
                        f"{device_name}_status_temperature_outside_in_celsius",
                        f"{device_name}_power_draw_kw"
                    ]
                    X_device = X_c[cols]
                    model_d = LinearRegression()
                    model_d.fit(X_device, y_device_c)
                    self.device_models_cool[device_name] = model_d
                elif self.device_func_type == "simple_linear":
                    cols = [f"{device_name}_status_temperature_outside_in_celsius"]
                    X_device = X_c[cols]
                    model_d = LinearRegression()
                    model_d.fit(X_device, y_device_c)
                    self.device_models_cool[device_name] = model_d
                elif self.device_func_type == "constant_offset":
                    t_outside = df_outside_raw.loc[X_c.index, f"{device_name}_status_temperature_outside_in_celsius"].values
                    offset = np.mean(y_device_c - t_outside)
                    self.device_models_cool[device_name] = ConstantOffsetModel(offset)

        # Fit Heating parameters (Stage 2) using ground truth return temperatures
        if is_heating.any():
            X_heat = X[is_heating]
            y_heat = y[is_heating].values
            
            T_ret, T_out, T_lag_norm, T_lag_raw = self._extract_features(X_heat, mode="heating", use_gt_ret=True)
            
            if hasattr(self.heat_func, "fit"):
                self.heat_func.fit(T_ret, T_out, T_lag_norm, T_lag_raw, y_heat)
                self.heat_params = None
            else:
                # Setup normalization parameters if polynomial function type
                if hasattr(self.heat_func, "fit_normalization"):
                    self.heat_func.fit_normalization(T_ret, T_out)
                    
                init_guess = np.zeros(self.heat_func.num_params)
                res = minimize(
                    loss_fn,
                    init_guess,
                    args=(self.heat_func, T_ret, T_out, T_lag_raw, T_lag_norm, y_heat),
                    method="L-BFGS-B"
                )
                self.heat_params = res.x
                print(f"Optimized Heating Parameters: {self.heat_params}")

        # Fit Cooling parameters (Stage 2) using ground truth return temperatures
        if (~is_heating).any():
            X_cool = X[~is_heating]
            y_cool = y[~is_heating].values
            
            T_ret, T_out, T_lag_norm, T_lag_raw = self._extract_features(X_cool, mode="cooling", use_gt_ret=True)
            
            if hasattr(self.cool_func, "fit"):
                self.cool_func.fit(T_ret, T_out, T_lag_norm, T_lag_raw, y_cool)
                self.cool_params = None
            else:
                # Setup normalization parameters if polynomial function type
                if hasattr(self.cool_func, "fit_normalization"):
                    self.cool_func.fit_normalization(T_ret, T_out)
                    
                init_guess = np.zeros(self.cool_func.num_params)
                res = minimize(
                    loss_fn,
                    init_guess,
                    args=(self.cool_func, T_ret, T_out, T_lag_raw, T_lag_norm, y_cool),
                    method="L-BFGS-B"
                )
                self.cool_params = res.x
                print(f"Optimized Cooling Parameters: {self.cool_params}")

        return self

    def predict(self, X):
        preds = np.zeros(len(X))
        is_heating = self._get_is_heating(X)
        
        if is_heating.any():
            X_heat = X[is_heating]
            T_ret, T_out, T_lag_norm, T_lag_raw = self._extract_features(X_heat, mode="heating", use_gt_ret=False)
            if self.lags > 0:
                delta_T = self.heat_func.evaluate(T_ret, T_out, T_lag_norm, T_lag_raw, self.heat_params)
                preds[is_heating] = T_lag_raw + delta_T
            else:
                preds[is_heating] = self.heat_func.evaluate(T_ret, T_out, None, None, self.heat_params)

        if (~is_heating).any():
            X_cool = X[~is_heating]
            T_ret, T_out, T_lag_norm, T_lag_raw = self._extract_features(X_cool, mode="cooling", use_gt_ret=False)
            if self.lags > 0:
                delta_T = self.cool_func.evaluate(T_ret, T_out, T_lag_norm, T_lag_raw, self.cool_params)
                preds[~is_heating] = T_lag_raw + delta_T
            else:
                preds[~is_heating] = self.cool_func.evaluate(T_ret, T_out, None, None, self.cool_params)

        return preds

    def _predict_device_returns(self, X):
        self._get_return_gt(X) # Make sure df_return_gt is populated
        
        preds_dict = {}
        is_heating_idx = self._get_is_heating(X)
        
        if self.device_func_type == "constant_offset":
            df_outside_raw = self._get_raw_outside_temps(X)
            
        for d in range(1, 5):
            device_name = f"device_{d}"
            preds_d = np.zeros(len(X))
            
            if self.device_funcs_is_simulator:
                if is_heating_idx.any():
                    X_h = X[is_heating_idx]
                    T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev = self._extract_device_features(X_h, device_name, mode="heating")
                    if self.lags > 0:
                        delta_T = self.device_heat_funcs[device_name].evaluate(
                            T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev, self.device_heat_params[device_name]
                        )
                        preds_d[is_heating_idx] = T_lag_raw_dev + delta_T
                    else:
                        preds_d[is_heating_idx] = self.device_heat_funcs[device_name].evaluate(
                            T_ret_dev, T_out_dev, None, None, self.device_heat_params[device_name]
                        )
                if (~is_heating_idx).any():
                    X_c = X[~is_heating_idx]
                    T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev = self._extract_device_features(X_c, device_name, mode="cooling")
                    if self.lags > 0:
                        delta_T = self.device_cool_funcs[device_name].evaluate(
                            T_ret_dev, T_out_dev, T_lag_norm_dev, T_lag_raw_dev, self.device_cool_params[device_name]
                        )
                        preds_d[~is_heating_idx] = T_lag_raw_dev + delta_T
                    else:
                        preds_d[~is_heating_idx] = self.device_cool_funcs[device_name].evaluate(
                            T_ret_dev, T_out_dev, None, None, self.device_cool_params[device_name]
                        )
            else:
                if self.device_func_type == "linear":
                    cols = [
                        f"{device_name}_status_temperature_outside_in_celsius",
                        f"{device_name}_power_draw_kw"
                    ]
                    X_device = X[cols]
                    if is_heating_idx.any():
                        preds_d[is_heating_idx] = self.device_models_heat[device_name].predict(X_device[is_heating_idx])
                    if (~is_heating_idx).any():
                        preds_d[~is_heating_idx] = self.device_models_cool[device_name].predict(X_device[~is_heating_idx])
                elif self.device_func_type == "simple_linear":
                    cols = [f"{device_name}_status_temperature_outside_in_celsius"]
                    X_device = X[cols]
                    if is_heating_idx.any():
                        preds_d[is_heating_idx] = self.device_models_heat[device_name].predict(X_device[is_heating_idx])
                    if (~is_heating_idx).any():
                        preds_d[~is_heating_idx] = self.device_models_cool[device_name].predict(X_device[~is_heating_idx])
                elif self.device_func_type == "constant_offset":
                    t_outside = df_outside_raw[f"{device_name}_status_temperature_outside_in_celsius"].values
                    if is_heating_idx.any():
                        preds_d[is_heating_idx] = self.device_models_heat[device_name].predict(t_outside[is_heating_idx])
                    if (~is_heating_idx).any():
                        preds_d[~is_heating_idx] = self.device_models_cool[device_name].predict(t_outside[~is_heating_idx])
                        
            preds_dict[device_name] = preds_d
                
        return pd.DataFrame(preds_dict, index=X.index)

    def _extract_device_features(self, X_sub, device_name, mode):
        """
        Extract return temperatures (lagged return temperatures of all devices), 
        outside temperatures, and target device lag (both raw and normalized).
        """
        out_cols = [f"device_{d}_status_temperature_outside_in_celsius" for d in range(1, 5)]
        T_out = X_sub[out_cols].values
        
        # T_ret: lagged return temperatures of all devices up to self.lags
        if self.lags > 0:
            T_ret_list = []
            for j in range(1, self.lags + 1):
                df_return_lag = self.df_return_gt.shift(j).reindex(X_sub.index).ffill().bfill()
                T_ret_list.append(df_return_lag.values)
            T_ret = np.hstack(T_ret_list)
        else:
            T_ret = np.empty((len(X_sub), 0))
        
        if self.lags > 0:
            # target device lag at previous timestamp (lag 1)
            df_return_lag_1 = self.df_return_gt.shift(1).reindex(X_sub.index).ffill().bfill()
            T_lag_raw = df_return_lag_1[f"{device_name}_status_temperature_return_in_celsius"].values
            if mode == "heating":
                mean_val = self.mean_ret_heat[device_name]
                std_val = self.std_ret_heat[device_name]
            else:
                mean_val = self.mean_ret_cool[device_name]
                std_val = self.std_ret_cool[device_name]
            
            T_lag_norm = (T_lag_raw - mean_val) / std_val
            return T_ret, T_out, T_lag_norm, T_lag_raw
        else:
            return T_ret, T_out, None, None

    def _extract_features(self, X_sub, mode, use_gt_ret=False):
        """
        Extract return temperatures (either ground-truth or predicted), outside temperatures, and target lag.
        """
        out_cols = [f"device_{d}_status_temperature_outside_in_celsius" for d in range(1, 5)]
        T_out = X_sub[out_cols].values
        
        if use_gt_ret:
            T_ret = self._get_return_gt(X_sub).values
        else:
            T_ret = self._predict_device_returns(X_sub).values
        
        if self.lags > 0:
            lag_col = "target_lag1"
            T_lag_norm = X_sub[lag_col].values
            
            if mode == "heating":
                T_lag_raw = T_lag_norm * self.std_y_heat + self.mean_y_heat
            else:
                T_lag_raw = T_lag_norm * self.std_y_cool + self.mean_y_cool
                
            return T_ret, T_out, T_lag_norm, T_lag_raw
        else:
            return T_ret, T_out, None, None


def fit(X_train, y_train, target_func_type="linear_full", device_func_type="linear"):
    # Detect the number of lags from column names
    lag_cols = [c for c in X_train.columns if c.startswith("target_lag")]
    lags = max([int(c.replace("target_lag", "")) for c in lag_cols]) if lag_cols else 0
    
    has_lag = lags > 0
    heat_func = get_target_function(target_func_type, has_lag=has_lag)
    cool_func = get_target_function(target_func_type, has_lag=has_lag)
    
    model = SimulatorModel(heat_func, cool_func, device_func_type=device_func_type, lags=lags)
    model.fit(X_train, y_train)
    return model


def predict(model, X_test):
    return model.predict(X_test)


def visualize_stages_analysis(
    model, 
    X_train_h, y_train_h, X_test_h, y_test_h, meta_h, 
    X_train_c, y_train_c, X_test_c, y_test_c, meta_c, 
    df_return_gt, 
    save_path="results/simulator_stages_analysis.png"
):
    import os
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from sklearn.metrics import mean_absolute_error, r2_score
    
    # 1. Generate predictions for Heating (both Train and Test)
    df_ret_pred_train_h = model._predict_device_returns(X_train_h)
    df_ret_pred_test_h = model._predict_device_returns(X_test_h)
    df_ret_pred_h = pd.concat([df_ret_pred_train_h, df_ret_pred_test_h])
    
    preds_room_train_h = model.predict(X_train_h)
    preds_room_test_h = predict_autoregressive(model, X_test_h, predict, model.lags, meta_h.get("mean", 0.0), meta_h.get("std", 1.0))
    preds_room_h = np.concatenate([preds_room_train_h, preds_room_test_h])
    
    y_ret_gt_h = df_return_gt.loc[df_ret_pred_h.index]
    y_room_gt_h = pd.concat([y_train_h, y_test_h])
    
    # 2. Generate predictions for Cooling (both Train and Test)
    df_ret_pred_train_c = model._predict_device_returns(X_train_c)
    df_ret_pred_test_c = model._predict_device_returns(X_test_c)
    df_ret_pred_c = pd.concat([df_ret_pred_train_c, df_ret_pred_test_c])
    
    preds_room_train_c = model.predict(X_train_c)
    preds_room_test_c = predict_autoregressive(model, X_test_c, predict, model.lags, meta_c.get("mean", 0.0), meta_c.get("std", 1.0))
    preds_room_c = np.concatenate([preds_room_train_c, preds_room_test_c])
    
    y_ret_gt_c = df_return_gt.loc[df_ret_pred_c.index]
    y_room_gt_c = pd.concat([y_train_c, y_test_c])
    
    # 3. Setup figure
    plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')
    fig, axes = plt.subplots(2, 5, figsize=(26, 12), dpi=150)
    fig.suptitle("Simulator Model: Stage-by-Stage Time Series Analysis (Seen & Unseen Periods)", fontsize=18, fontweight='bold')
    
    # Styling colors
    c_real = "#2c3e50"
    c_train = "#2ecc71"
    c_test_ret = "#e67e22"
    c_test_room = "#9b59b6"
    
    seasons = [
        ("Heating Season", X_train_h.index, X_test_h.index, y_ret_gt_h, df_ret_pred_train_h, df_ret_pred_test_h, y_room_gt_h, preds_room_train_h, preds_room_test_h, 0),
        ("Cooling Season", X_train_c.index, X_test_c.index, y_ret_gt_c, df_ret_pred_train_c, df_ret_pred_test_c, y_room_gt_c, preds_room_train_c, preds_room_test_c, 1)
    ]
    
    for season_name, train_idx, test_idx, ret_gt, ret_pred_train, ret_pred_test, room_gt, room_pred_train, room_pred_test, row in seasons:
        full_idx = np.concatenate([train_idx, test_idx])
        split_ts = train_idx[-1]
        
        # Columns 1 to 4: Devices 1 to 4 return temperatures
        for d in range(1, 5):
            col = d - 1
            ax = axes[row, col]
            
            device_name = f"device_{d}"
            gt_col = f"{device_name}_status_temperature_return_in_celsius"
            
            gt_vals = ret_gt[gt_col].values
            pred_train_vals = ret_pred_train[device_name].values
            pred_test_vals = ret_pred_test[device_name].values
            
            mae_train = mean_absolute_error(ret_gt.loc[train_idx, gt_col], pred_train_vals)
            mae_test = mean_absolute_error(ret_gt.loc[test_idx, gt_col], pred_test_vals)
            r2_test = r2_score(ret_gt.loc[test_idx, gt_col], pred_test_vals)
            
            # Plot Ground Truth (Full)
            ax.plot(full_idx, gt_vals, color=c_real, label="Real Value", linewidth=1.5, alpha=0.85)
            # Plot Train predictions
            ax.plot(train_idx, pred_train_vals, color=c_train, label="Predicted (Train/Seen)", linewidth=1.2, alpha=0.85)
            # Plot Test predictions
            ax.plot(test_idx, pred_test_vals, color=c_test_ret, label="Predicted (Test/Unseen)", linewidth=1.5, alpha=0.9)
            
            # Split line and shading
            ax.axvline(x=split_ts, color="#7f8c8d", linestyle="-.", linewidth=1.5, alpha=0.8)
            ax.axvspan(full_idx[0], split_ts, color="#2ecc71", alpha=0.05)
            ax.axvspan(split_ts, full_idx[-1], color="#3498db", alpha=0.05)
            
            ax.set_title(f"{season_name}: Device {d} Return Temp\nTrain MAE: {mae_train:.3f}°C | Test MAE: {mae_test:.3f}°C | R²: {r2_test:.3f}", fontsize=10, fontweight='semibold')
            ax.set_ylabel("Temp (°C)")
            ax.tick_params(axis='x', rotation=30)
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d\n%H:%M'))
            if col == 0 and row == 0:
                ax.legend(loc="upper left")
                
        # Column 5: Target Room Temperature
        ax = axes[row, 4]
        mae_train_room = mean_absolute_error(room_gt.loc[train_idx], room_pred_train)
        mae_test_room = mean_absolute_error(room_gt.loc[test_idx], room_pred_test)
        r2_test_room = r2_score(room_gt.loc[test_idx], room_pred_test)
        
        # Plot Ground Truth (Full)
        ax.plot(full_idx, room_gt.values, color=c_real, label="Real Value", linewidth=1.5, alpha=0.85)
        # Plot Train predictions
        ax.plot(train_idx, room_pred_train, color=c_train, label="Predicted (Train/Seen)", linewidth=1.2, alpha=0.85)
        # Plot Test predictions (Autoregressive)
        ax.plot(test_idx, room_pred_test, color=c_test_room, label="Predicted (Test/Unseen AR)", linewidth=1.5, alpha=0.9)
        
        # Split line and shading
        ax.axvline(x=split_ts, color="#7f8c8d", linestyle="-.", linewidth=1.5, alpha=0.8)
        ax.axvspan(full_idx[0], split_ts, color="#2ecc71", alpha=0.05)
        ax.axvspan(split_ts, full_idx[-1], color="#3498db", alpha=0.05)
        
        ax.set_title(f"{season_name}: Room Target Temp\nTrain MAE: {mae_train_room:.3f}°C | Test MAE: {mae_test_room:.3f}°C | R²: {r2_test_room:.3f}", fontsize=10, fontweight='semibold', color="#8e44ad")
        ax.set_ylabel("Temp (°C)")
        ax.tick_params(axis='x', rotation=30)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d\n%H:%M'))
        if row == 0:
            ax.legend(loc="upper left")
            
    fig.autofmt_xdate()
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    plt.savefig(save_path, dpi=150)
    print(f"Saved stage-by-stage visualization to {save_path}")
    plt.close()
