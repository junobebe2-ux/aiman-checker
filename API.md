# BUAT USER MEMBER
POST /api/auth/register
{ "email": "...", "password": "..." }

# LOGIN
POST /api/auth/login  
{ "email": "...", "password": "..." }
→ { token, user }

# CEK STATUS
GET /api/auth/me
Header: Authorization: Bearer <token>
→ { user, role, limits }

# CHECK DOMAIN
POST /api/check 
{ "urls": [...] }
→ otomatis detek guest/member dari header

# CREATE PAYMENT
POST /api/payment/create
Header: Authorization: Bearer <token>
{ "plan": "pro" }
→ { payment_address, amount, ref_id }

# CEK PAYMENT STATUS
GET /api/payment/status/:ref_id

# ADMIN
GET /api/admin/users
PUT /api/admin/user/:id/role
GET /api/admin/transactions
PUT /api/admin/settings