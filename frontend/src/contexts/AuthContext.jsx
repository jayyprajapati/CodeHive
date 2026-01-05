import { createContext, useEffect, useState, useContext } from "react";
import { auth } from "../firebase";
import PropTypes from 'prop-types';

export const AuthContext = createContext();

export const useAuth = () => {
    return useContext(AuthContext);
  };

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
          setCurrentUser(user);
          setLoading(false);
        });
    
        return unsubscribe;
      }, []);

      return (
        <AuthContext.Provider value={{ currentUser, loading }}>
          {!loading && children}
        </AuthContext.Provider>
      );
}

AuthProvider.propTypes = {
    children: PropTypes.node.isRequired
  };