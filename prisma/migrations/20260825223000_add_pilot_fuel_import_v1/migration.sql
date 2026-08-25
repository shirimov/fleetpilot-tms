-- CreateEnum
CREATE TYPE "FinancialTransactionRole" AS ENUM ('ECONOMIC', 'CASH_SETTLEMENT', 'RECOVERY');

-- CreateEnum
CREATE TYPE "PilotInvoiceStatus" AS ENUM ('UPLOADED', 'PARSED', 'NEEDS_REVIEW', 'READY_TO_POST', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PilotDocumentRole" AS ENUM ('STRUCTURED_SOURCE', 'DOCUMENTARY', 'SUPPLEMENTAL');

-- CreateEnum
CREATE TYPE "PilotProductType" AS ENUM ('TRUCK_DIESEL', 'REEFER_FUEL', 'DEF', 'UNKNOWN_PRODUCT');

-- CreateEnum
CREATE TYPE "PilotTruckMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'MANUALLY_MATCHED');

-- CreateEnum
CREATE TYPE "PilotAdjustmentType" AS ENUM ('FREIGHT_RATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PilotImportIssueCode" AS ENUM ('UNMATCHED_TRUCK', 'AMBIGUOUS_TRUCK', 'UNKNOWN_PRODUCT', 'MISSING_CATEGORY', 'AMOUNT_MISMATCH', 'DUPLICATE_INVOICE', 'DUPLICATE_EVENT', 'DUPLICATE_LINE', 'UNKNOWN_ADJUSTMENT', 'INVALID_DATE', 'INVALID_AMOUNT', 'INVALID_QUANTITY', 'INVALID_STRUCTURE', 'OUTSIDE_PERIOD');

-- CreateEnum
CREATE TYPE "PilotImportIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "FinancialAllocation" ADD COLUMN     "pilotAdjustmentId" TEXT,
ADD COLUMN     "pilotProductLineId" TEXT;

-- AlterTable
ALTER TABLE "FinancialAuditEvent" ADD COLUMN     "pilotProviderInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "role" "FinancialTransactionRole" NOT NULL DEFAULT 'ECONOMIC';

-- CreateTable
CREATE TABLE "PilotProviderInvoice" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PILOT',
    "providerAccountHash" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingDate" DATE NOT NULL,
    "dueDate" DATE,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "invoiceTotalMinor" BIGINT NOT NULL,
    "parsedTotalMinor" BIGINT NOT NULL,
    "differenceMinor" BIGINT NOT NULL,
    "status" "PilotInvoiceStatus" NOT NULL DEFAULT 'UPLOADED',
    "parseVersion" TEXT NOT NULL,
    "expectationId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotProviderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotInvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "role" "PilotDocumentRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotFuelingEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "eventKeyHash" TEXT NOT NULL,
    "ticketHash" TEXT NOT NULL,
    "authorizationHash" TEXT NOT NULL,
    "cardLastFour" TEXT,
    "sourceUnitNumber" TEXT NOT NULL,
    "locationNumber" TEXT,
    "city" TEXT,
    "state" TEXT,
    "purchaseOrderContext" TEXT,
    "sourceDriverName" TEXT,
    "transactionDate" DATE NOT NULL,
    "odometer" DECIMAL(18,2),
    "truckId" TEXT,
    "truckMatchStatus" "PilotTruckMatchStatus" NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotFuelingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotFuelProductLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "importRecordId" TEXT NOT NULL,
    "lineFingerprint" TEXT NOT NULL,
    "sourceLineIdentity" TEXT NOT NULL,
    "sourceProductCode" TEXT NOT NULL,
    "productType" "PilotProductType" NOT NULL,
    "quantity" DECIMAL(18,2) NOT NULL,
    "unitPrice" DECIMAL(18,7) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "retailAmountMinor" BIGINT,
    "savingsMinor" BIGINT,
    "taxMinor" BIGINT,
    "discountMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotFuelProductLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotInvoiceAdjustment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "importRecordId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceLineIdentity" TEXT NOT NULL,
    "type" "PilotAdjustmentType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "transactionDate" DATE,
    "signedAmountMinor" BIGINT NOT NULL,
    "categoryId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotInvoiceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotImportIssue" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "eventId" TEXT,
    "productLineId" TEXT,
    "adjustmentId" TEXT,
    "code" "PilotImportIssueCode" NOT NULL,
    "status" "PilotImportIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "resolutionMetadata" JSONB,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotProductMapping" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PILOT',
    "providerAccountHash" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productType" "PilotProductType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotProviderInvoice_expectationId_key" ON "PilotProviderInvoice"("expectationId");

-- CreateIndex
CREATE INDEX "PilotProviderInvoice_operatingGroupId_status_billingDate_idx" ON "PilotProviderInvoice"("operatingGroupId", "status", "billingDate");

-- CreateIndex
CREATE INDEX "PilotProviderInvoice_sourceId_billingDate_idx" ON "PilotProviderInvoice"("sourceId", "billingDate");

-- CreateIndex
CREATE UNIQUE INDEX "PilotProviderInvoice_operatingGroupId_provider_providerAcco_key" ON "PilotProviderInvoice"("operatingGroupId", "provider", "providerAccountHash", "invoiceNumber");

-- CreateIndex
CREATE INDEX "PilotInvoiceDocument_invoiceId_role_idx" ON "PilotInvoiceDocument"("invoiceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvoiceDocument_invoiceId_statementId_key" ON "PilotInvoiceDocument"("invoiceId", "statementId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvoiceDocument_statementId_role_key" ON "PilotInvoiceDocument"("statementId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PilotFuelingEvent_transactionId_key" ON "PilotFuelingEvent"("transactionId");

-- CreateIndex
CREATE INDEX "PilotFuelingEvent_invoiceId_transactionDate_idx" ON "PilotFuelingEvent"("invoiceId", "transactionDate");

-- CreateIndex
CREATE INDEX "PilotFuelingEvent_truckId_transactionDate_idx" ON "PilotFuelingEvent"("truckId", "transactionDate");

-- CreateIndex
CREATE INDEX "PilotFuelingEvent_invoiceId_truckMatchStatus_idx" ON "PilotFuelingEvent"("invoiceId", "truckMatchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PilotFuelingEvent_invoiceId_eventKeyHash_key" ON "PilotFuelingEvent"("invoiceId", "eventKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "PilotFuelProductLine_importRecordId_key" ON "PilotFuelProductLine"("importRecordId");

-- CreateIndex
CREATE INDEX "PilotFuelProductLine_invoiceId_productType_idx" ON "PilotFuelProductLine"("invoiceId", "productType");

-- CreateIndex
CREATE INDEX "PilotFuelProductLine_eventId_productType_idx" ON "PilotFuelProductLine"("eventId", "productType");

-- CreateIndex
CREATE INDEX "PilotFuelProductLine_categoryId_idx" ON "PilotFuelProductLine"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotFuelProductLine_invoiceId_sourceLineIdentity_key" ON "PilotFuelProductLine"("invoiceId", "sourceLineIdentity");

CREATE INDEX "PilotFuelProductLine_invoiceId_lineFingerprint_idx" ON "PilotFuelProductLine"("invoiceId", "lineFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvoiceAdjustment_importRecordId_key" ON "PilotInvoiceAdjustment"("importRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvoiceAdjustment_transactionId_key" ON "PilotInvoiceAdjustment"("transactionId");

-- CreateIndex
CREATE INDEX "PilotInvoiceAdjustment_invoiceId_type_idx" ON "PilotInvoiceAdjustment"("invoiceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvoiceAdjustment_invoiceId_sourceLineIdentity_key" ON "PilotInvoiceAdjustment"("invoiceId", "sourceLineIdentity");

CREATE INDEX "PilotInvoiceAdjustment_invoiceId_fingerprint_idx" ON "PilotInvoiceAdjustment"("invoiceId", "fingerprint");

-- CreateIndex
CREATE INDEX "PilotImportIssue_invoiceId_status_code_idx" ON "PilotImportIssue"("invoiceId", "status", "code");

-- CreateIndex
CREATE INDEX "PilotImportIssue_eventId_status_idx" ON "PilotImportIssue"("eventId", "status");

-- CreateIndex
CREATE INDEX "PilotImportIssue_productLineId_status_idx" ON "PilotImportIssue"("productLineId", "status");

-- CreateIndex
CREATE INDEX "PilotImportIssue_adjustmentId_status_idx" ON "PilotImportIssue"("adjustmentId", "status");

-- CreateIndex
CREATE INDEX "PilotProductMapping_categoryId_isActive_idx" ON "PilotProductMapping"("categoryId", "isActive");

-- CreateIndex
CREATE INDEX "PilotProductMapping_approvedByUserId_approvedAt_idx" ON "PilotProductMapping"("approvedByUserId", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotProductMapping_operatingGroupId_provider_providerAccountHash_productCode_key" ON "PilotProductMapping"("operatingGroupId", "provider", "providerAccountHash", "productCode");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAllocation_pilotProductLineId_key" ON "FinancialAllocation"("pilotProductLineId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAllocation_pilotAdjustmentId_key" ON "FinancialAllocation"("pilotAdjustmentId");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_pilotProviderInvoiceId_occurredAt_id_idx" ON "FinancialAuditEvent"("pilotProviderInvoiceId", "occurredAt", "id");

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_pilotProductLineId_fkey" FOREIGN KEY ("pilotProductLineId") REFERENCES "PilotFuelProductLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_pilotAdjustmentId_fkey" FOREIGN KEY ("pilotAdjustmentId") REFERENCES "PilotInvoiceAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_pilotProviderInvoiceId_fkey" FOREIGN KEY ("pilotProviderInvoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProviderInvoice" ADD CONSTRAINT "PilotProviderInvoice_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProviderInvoice" ADD CONSTRAINT "PilotProviderInvoice_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProviderInvoice" ADD CONSTRAINT "PilotProviderInvoice_expectationId_fkey" FOREIGN KEY ("expectationId") REFERENCES "FinancialExpectation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProviderInvoice" ADD CONSTRAINT "PilotProviderInvoice_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProviderInvoice" ADD CONSTRAINT "PilotProviderInvoice_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceDocument" ADD CONSTRAINT "PilotInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceDocument" ADD CONSTRAINT "PilotInvoiceDocument_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelingEvent" ADD CONSTRAINT "PilotFuelingEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelingEvent" ADD CONSTRAINT "PilotFuelingEvent_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelingEvent" ADD CONSTRAINT "PilotFuelingEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelProductLine" ADD CONSTRAINT "PilotFuelProductLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelProductLine" ADD CONSTRAINT "PilotFuelProductLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PilotFuelingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelProductLine" ADD CONSTRAINT "PilotFuelProductLine_importRecordId_fkey" FOREIGN KEY ("importRecordId") REFERENCES "FinancialImportRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFuelProductLine" ADD CONSTRAINT "PilotFuelProductLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceAdjustment" ADD CONSTRAINT "PilotInvoiceAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceAdjustment" ADD CONSTRAINT "PilotInvoiceAdjustment_importRecordId_fkey" FOREIGN KEY ("importRecordId") REFERENCES "FinancialImportRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceAdjustment" ADD CONSTRAINT "PilotInvoiceAdjustment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvoiceAdjustment" ADD CONSTRAINT "PilotInvoiceAdjustment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotImportIssue" ADD CONSTRAINT "PilotImportIssue_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PilotProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotImportIssue" ADD CONSTRAINT "PilotImportIssue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PilotFuelingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotImportIssue" ADD CONSTRAINT "PilotImportIssue_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "PilotFuelProductLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotImportIssue" ADD CONSTRAINT "PilotImportIssue_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PilotInvoiceAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotImportIssue" ADD CONSTRAINT "PilotImportIssue_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProductMapping" ADD CONSTRAINT "PilotProductMapping_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProductMapping" ADD CONSTRAINT "PilotProductMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotProductMapping" ADD CONSTRAINT "PilotProductMapping_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
