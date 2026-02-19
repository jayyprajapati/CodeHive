/**
 * StatusChip — Squared notification chips stacked top-right
 * Types: success, warning, error
 */
export default function StatusChip({ chips, onClose }) {
    if (!chips || chips.length === 0) return null;

    return (
        <div className="chip-container">
            {chips.map((chip) => (
                <div key={chip.id} className={`chip chip--${chip.type}`}>
                    <span className="chip-message">{chip.message}</span>
                    <button
                        className="chip-close"
                        onClick={() => onClose(chip.id)}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
