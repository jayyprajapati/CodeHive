import React from 'react';
import './Button.css';

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'medium', 
  disabled = false, 
  startIcon, 
  onClick, 
  className = '',
  ...props 
}) => {
  const buttonClass = `
    custom-btn 
    custom-btn--${variant} 
    custom-btn--${size} 
    ${disabled ? 'custom-btn--disabled' : ''} 
    ${className}
  `.trim();

  return (
    <button 
      className={buttonClass} 
      onClick={onClick} 
      disabled={disabled}
      {...props}
    >
      {startIcon && <span className="custom-btn__icon">{startIcon}</span>}
      <span className="custom-btn__text">{children}</span>
    </button>
  );
};

export default Button;
