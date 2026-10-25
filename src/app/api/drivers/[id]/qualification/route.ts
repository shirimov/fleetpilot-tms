import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDriverDocuments } from "@/lib/drivers/document-authorization";
import { driverRouteError } from "@/lib/drivers/route-response";
import { DriverValidationError } from "@/lib/drivers/validation";
import { PRIVATE_NO_STORE_HEADERS } from "@/lib/security/cache-headers";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const context = await requireDriverDocuments(id);
    const page = Math.max(
      1,
      Number.parseInt(
        new URL(request.url).searchParams.get("page") || "1",
        10,
      ) || 1,
    );
    const where = { driverId: id, companyId: context.companyId };
    const [total, reviews] = await prisma.$transaction([
      prisma.driverQualificationReview.count({ where }),
      prisma.driverQualificationReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
        skip: (page - 1) * 20,
      }),
    ]);
    return NextResponse.json(
      { reviews, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return driverRouteError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const context = await requireDriverDocuments(id, true);
    const body = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["PENDING", "REVIEWED", "NEEDS_FOLLOW_UP"].includes(body.outcome) ||
      typeof body.notes !== "string" ||
      !body.notes.trim() ||
      body.notes.length > 2000
    )
      throw new DriverValidationError(
        "Select an internal review outcome and enter notes (up to 2,000 characters).",
      );
    const review = await prisma.$transaction(async (tx) => {
      const review = await tx.driverQualificationReview.create({
        data: {
          companyId: context.companyId,
          driverId: id,
          outcome: body.outcome,
          notes: body.notes.trim(),
          reviewerId: context.user.id,
          reviewerName: context.user.displayName,
        },
      });
      await tx.driverAudit.create({
        data: {
          companyId: context.companyId,
          driverId: id,
          actorId: context.user.id,
          actorName: context.user.displayName,
          action: "QUALIFICATION_REVIEWED",
          metadata: { reviewId: review.id, outcome: review.outcome },
        },
      });
      return review;
    });
    return NextResponse.json(review, {
      status: 201,
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    return driverRouteError(error);
  }
}
