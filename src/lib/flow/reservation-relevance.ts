/**
 * Stay-shaped relevance adapter. The Request table uses a generic time spine;
 * this maps the older check-in/check-out fields onto it so existing tests keep
 * their hospitality-shaped fixtures.
 */
import { isRequestStillRelevant } from "@/lib/requests";

export function isReservationStillRelevant(
  reservation: {
    status: string;
    checkInDate: Date | string;
    checkOutDate: Date | string;
  },
  now: Date = new Date(),
): boolean {
  return isRequestStillRelevant(
    {
      status: reservation.status,
      startAt: reservation.checkInDate,
      endAt: reservation.checkOutDate,
    },
    now,
  );
}
