export default function OrionHologram({ className = "" }) {
  return (
    <div className={`orion-hologram ${className}`.trim()} aria-hidden title="Orion heat pump unit">
      <img
        src="/orion-hologram.gif"
        alt=""
        className="orion-hologram__gif"
        draggable={false}
        width={176}
        height={176}
      />
    </div>
  );
}
