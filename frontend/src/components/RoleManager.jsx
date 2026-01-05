import PropTypes from "prop-types";

export default function RoleManager({ users, onRoleChange }) {
  return (
    <div className="role-manager">
      <div className="role-manager-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.67,13.02C10.45,13.01 10.23,13 10,13C9.77,13.01 9.54,13.02 9.32,13.02C5.96,13.21 4,14.74 4,16.5V19H11.24C11.1,18.5 11,17.98 11,17.45C11,15.7 11.73,14.14 12.89,13.04C12.2,13.03 11.43,13.02 10.67,13.02M10,4A4,4 0 0,0 6,8A4,4 0 0,0 10,12A4,4 0 0,0 14,8A4,4 0 0,0 10,4M17.45,22A2.55,2.55 0 0,1 15,19.5A2.55,2.55 0 0,1 17.45,17A2.55,2.55 0 0,1 20,19.5A2.55,2.55 0 0,1 17.45,22M22,19.5C22,18.23 21,17.25 19.72,17.25C19.5,17.25 19.29,17.3 19.1,17.38L21.8,20.05C21.87,19.87 21.91,19.69 21.91,19.5H22M13.91,19.5C13.91,20.77 14.89,21.75 16.16,21.75C16.38,21.75 16.59,21.7 16.78,21.62L14.08,18.95C14.01,19.13 13.97,19.31 13.97,19.5H13.91Z"/>
        </svg>
        Manage Roles
      </div>
      {users.map((user) => (
        <div className="manage-user-name-role" key={user.name}>
          <div className="manage-user-name">{user.name}</div>
          <select
            className="manage-user-role-dropdown"
            value={user.role} // Use the role from the user object
            onChange={(e) => onRoleChange(user.name, e.target.value)} // Directly call onRoleChange
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </div>
      ))}
    </div>
  );
}

RoleManager.propTypes = {
  users: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      role: PropTypes.string.isRequired,
    })
  ).isRequired,
  onRoleChange: PropTypes.func.isRequired,
};
