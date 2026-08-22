-- Additive, single-use email authentication state for pre-provisioned users.
CREATE TABLE "EmailSignInToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSignInToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSignInRequest" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSignInRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSignInToken_tokenHash_key" ON "EmailSignInToken"("tokenHash");
CREATE INDEX "EmailSignInToken_userId_createdAt_idx" ON "EmailSignInToken"("userId", "createdAt");
CREATE INDEX "EmailSignInToken_email_createdAt_idx" ON "EmailSignInToken"("email", "createdAt");
CREATE INDEX "EmailSignInToken_expiresAt_idx" ON "EmailSignInToken"("expiresAt");
CREATE INDEX "EmailSignInRequest_emailHash_createdAt_idx" ON "EmailSignInRequest"("emailHash", "createdAt");
CREATE INDEX "EmailSignInRequest_ipHash_createdAt_idx" ON "EmailSignInRequest"("ipHash", "createdAt");
CREATE INDEX "EmailSignInRequest_createdAt_idx" ON "EmailSignInRequest"("createdAt");

ALTER TABLE "EmailSignInToken" ADD CONSTRAINT "EmailSignInToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
