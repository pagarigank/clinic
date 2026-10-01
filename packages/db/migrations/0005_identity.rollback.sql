-- 0005_identity rollback: drop auth/RBAC tables, children first.
DROP TABLE IF EXISTS breakglass_sessions;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS mfa_secrets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_branches;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;
