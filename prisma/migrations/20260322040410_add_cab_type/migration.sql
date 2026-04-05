-- CreateEnum
CREATE TYPE "CabType" AS ENUM ('DAYCAB', 'SLEEPER', 'OWNER_OP');

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "cabType" "CabType" NOT NULL DEFAULT 'SLEEPER';
