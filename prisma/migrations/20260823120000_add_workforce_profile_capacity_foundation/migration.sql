-- Additive workforce profile, schedule, skill, and task-planning foundation.
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY');
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'LEAVE', 'INACTIVE', 'TERMINATED');
CREATE TYPE "EmployeePayType" AS ENUM ('SALARY', 'HOURLY');
CREATE TYPE "EmployeePayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY');
CREATE TYPE "TaskBlockedReason" AS ENUM ('WAITING_ON_CUSTOMER', 'WAITING_ON_DRIVER', 'WAITING_ON_VENDOR', 'WAITING_ON_MANAGER', 'WAITING_ON_GOVERNMENT_DMV', 'WAITING_ON_AMAZON', 'WAITING_ON_INSURANCE', 'TECHNICAL_ISSUE', 'OTHER');
ALTER TYPE "TaskActivityAction" ADD VALUE 'EFFORT_CHANGED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'EXPECTED_DURATION_CHANGED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'BLOCKING_CHANGED';

ALTER TABLE "Employee"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "preferredName" TEXT,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "managerId" TEXT,
  ADD COLUMN "workLocation" TEXT,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
  ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "birthDate" TIMESTAMP(3),
  ADD COLUMN "address" TEXT,
  ADD COLUMN "emergencyContact" TEXT,
  ADD COLUMN "privateNotes" TEXT,
  ADD COLUMN "photoStorageKey" TEXT,
  ADD COLUMN "photoMimeType" TEXT,
  ADD COLUMN "payType" "EmployeePayType" NOT NULL DEFAULT 'SALARY',
  ADD COLUMN "payFrequency" "EmployeePayFrequency" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "compensationEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "compensationNotes" TEXT;

CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");
CREATE INDEX "Employee_companyId_employmentStatus_idx" ON "Employee"("companyId", "employmentStatus");
CREATE INDEX "Employee_companyId_managerId_idx" ON "Employee"("companyId", "managerId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmployeeScheduleDay" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "isWorking" BOOLEAN NOT NULL DEFAULT false,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  "capacityMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeScheduleDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeScheduleDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmployeeScheduleDay_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "EmployeeScheduleDay_minutes_check" CHECK (
    ("startMinute" IS NULL OR "startMinute" BETWEEN 0 AND 1439) AND
    ("endMinute" IS NULL OR "endMinute" BETWEEN 0 AND 1439) AND
    "breakMinutes" BETWEEN 0 AND 1440 AND
    "capacityMinutes" BETWEEN 0 AND 1440
  )
);
CREATE UNIQUE INDEX "EmployeeScheduleDay_employeeId_weekday_key" ON "EmployeeScheduleDay"("employeeId", "weekday");
CREATE INDEX "EmployeeScheduleDay_employeeId_isWorking_idx" ON "EmployeeScheduleDay"("employeeId", "isWorking");

CREATE TABLE "EmployeeSkillDefinition" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeSkillDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeSkillDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmployeeSkillDefinition_companyId_name_key" ON "EmployeeSkillDefinition"("companyId", "name");
CREATE INDEX "EmployeeSkillDefinition_companyId_isActive_name_idx" ON "EmployeeSkillDefinition"("companyId", "isActive", "name");

CREATE TABLE "EmployeeSkill" (
  "employeeId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("employeeId", "skillId"),
  CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "EmployeeSkillDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmployeeSkill_skillId_employeeId_idx" ON "EmployeeSkill"("skillId", "employeeId");

ALTER TABLE "TaskCard"
  ADD COLUMN "effort" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "expectedDurationMinutes" INTEGER,
  ADD COLUMN "blockedReason" "TaskBlockedReason",
  ADD COLUMN "blockedSince" TIMESTAMP(3),
  ADD COLUMN "blockedNote" TEXT,
  ADD COLUMN "blockedClearedAt" TIMESTAMP(3),
  ADD CONSTRAINT "TaskCard_effort_check" CHECK ("effort" BETWEEN 1 AND 5),
  ADD CONSTRAINT "TaskCard_expectedDurationMinutes_check" CHECK ("expectedDurationMinutes" IS NULL OR "expectedDurationMinutes" > 0);
CREATE INDEX "TaskCard_assigneeUserId_dueDate_status_idx" ON "TaskCard"("assigneeUserId", "dueDate", "status");
