#!/usr/bin/env bash
# scripts/setup-test-db.sh
# Creates the stonyx_orm_test database and stonyx_test user.
# Idempotent — safe to re-run. Requires local MySQL with root access.

set -euo pipefail

echo "Setting up stonyx-orm test database..."

mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS stonyx_orm_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stonyx_test'@'localhost' IDENTIFIED BY 'stonyx_test';
GRANT ALL PRIVILEGES ON stonyx_orm_test.* TO 'stonyx_test'@'localhost';
FLUSH PRIVILEGES;
SQL

echo ""
echo "Done! Test database 'stonyx_orm_test' is ready."
echo "User: stonyx_test / Password: stonyx_test"
echo ""
echo "Run tests with: npm test"
