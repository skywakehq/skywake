import { APIError } from "better-auth/api";

/**
 * The person's membership in their active organization, or null when they
 * no longer have one. Someone removed from the organization keeps it as their
 * active one, and Better Auth then throws "Member not found" instead of
 * answering null.
 */
export async function membershipOf<Member>(lookup: () => Promise<Member | null>) {
  try {
    return await lookup();
  } catch (error) {
    if (error instanceof APIError) return null;
    throw error;
  }
}
