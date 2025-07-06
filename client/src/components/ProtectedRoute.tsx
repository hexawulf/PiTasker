import { ReactNode } from 'react';
import { Route, Redirect, RouteProps } from 'wouter';

interface ProtectedRouteProps extends RouteProps {
  component: React.ComponentType<any>;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ component: Component, ...rest }) => {
  // This is a simple check. In a real app, use a more robust auth state (e.g., context, Zustand, Redux).
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';

  return (
    <Route
      {...rest}
      component={(props) =>
        isAuthenticated ? <Component {...props} /> : <Redirect to="/login" />
      }
    />
  );
};

export default ProtectedRoute;
