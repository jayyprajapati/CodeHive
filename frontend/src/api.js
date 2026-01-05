import axios from 'axios'

export const verifySession = async (sessionId, password) => {
    try {
      const verifySessionEndpoint = import.meta.env.VITE_WEBSOCKET_URL + '/api/validateSession/verify-session';
      const response = await axios.post(verifySessionEndpoint, { sessionId, password });
      if (response.status !== 200) throw new Error('Verification failed');
      return await response.data;
    } catch (error) {
      console.error('Session verification error:', error);
      return { valid: false, error: error.message };
    }
  };

  export const createNewSession = async (sessionId, password, owner) => {
    try {
        const createSessionEndpoint = import.meta.env.VITE_WEBSOCKET_URL + '/api/validateSession/create-session';
        const response = await axios.post(createSessionEndpoint, { sessionId, password, owner });
        if (response.status !== 200) throw new Error('Session Creation failed');
        return await response.data;
    } catch (error) {
        console.error('Session creation error:', error);
        return { valid: false, error: error.message };
      }
  }