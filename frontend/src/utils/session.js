export const generateSessionId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const parts = [];
    
    for(let i=0; i<4; i++) {
      let part = '';
      for(let j=0; j<4; j++) {
        part += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      parts.push(part);
    }
    
    return parts.join('-');
  };
  
  export const generateStrongPassword = () => {
    return window.crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(-8);
  };