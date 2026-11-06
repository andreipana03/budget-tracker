-- name: GetHousehold :one
SELECT * FROM households WHERE id = $1;
