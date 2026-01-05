import React, { useState } from 'react';
import './Input.css';

const Input = ({ 
  label, 
  type = 'text', 
  value, 
  onChange, 
  placeholder,
  disabled = false,
  size = 'medium',
  error = false,
  helperText = '',
  className = '',
  ...props 
}) => {
  const [focused, setFocused] = useState(false);

  const inputClass = `
    custom-input 
    custom-input--${size}
    ${focused ? 'custom-input--focused' : ''} 
    ${error ? 'custom-input--error' : ''}
    ${disabled ? 'custom-input--disabled' : ''} 
    ${className}
  `.trim();

  const hasValue = value && value.length > 0;

  return (
    <div className="custom-input-wrapper">
      <div className={inputClass}>
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="custom-input__field"
          {...props}
        />
        {label && (
          <label className={`custom-input__label ${focused || hasValue ? 'custom-input__label--floating' : ''}`}>
            {label}
          </label>
        )}
      </div>
      {helperText && (
        <div className={`custom-input__helper ${error ? 'custom-input__helper--error' : ''}`}>
          {helperText}
        </div>
      )}
    </div>
  );
};

export default Input;
