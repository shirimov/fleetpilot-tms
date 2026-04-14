-- CreateTable
CREATE TABLE "DispatchReserve" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEscrow" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeEscrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowTx" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeEscrow_employeeId_key" ON "EmployeeEscrow"("employeeId");

-- AddForeignKey
ALTER TABLE "EscrowTx" ADD CONSTRAINT "EscrowTx_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "EmployeeEscrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
