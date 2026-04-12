-- CreateEnum
CREATE TYPE "TmFundTxType" AS ENUM ('DEPOSIT', 'PAYMENT', 'EXPENSE', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "salary" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TmFund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Turkmenistan Fund',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TmFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TmFundTx" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "type" "TmFundTxType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "employeeId" TEXT,
    "paymentRef" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TmFundTx_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TmFundTx" ADD CONSTRAINT "TmFundTx_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "TmFund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
