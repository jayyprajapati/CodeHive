import React from 'react';
import './Checkbox.css';

const Checkbox = ({ 
  checked = false, 
  onChange, 
  label, 
  disabled = false, 
  className = '',
  ...props 
}) => {
  const checkboxClass = `
    custom-checkbox-wrapper
    ${disabled ? 'custom-checkbox-wrapper--disabled' : ''} 
    ${className}
  `.trim();

  return (
    <label className={checkboxClass}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="custom-checkbox__input"
        {...props}
      />
      <span className="custom-checkbox__checkmark">
        <svg 
          className="custom-checkbox__icon" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="3"
        >
          <polyline points="20,6 9,17 4,12" />
        </svg>
      </span>
      {label && <span className="custom-checkbox__label">{label}</span>}
    </label>
  );
};

export default Checkbox;
