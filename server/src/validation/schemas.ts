import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
});

export const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(500).optional(),
  birthDate: z
    .string()
    .datetime()
    .optional()
    .refine((d) => {
      if (!d) return false;
      const age = (Date.now() - new Date(d).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return age >= 18 && age <= 120;
    }, "Must be 18 or older"),
  gender: z.string().min(1).max(50).optional(),
  seeking: z.array(z.string()).max(10).optional(),
  preferences: z
    .object({
      distanceRadiusKm: z.number().min(1).max(500).optional(),
      ageMin: z.number().min(18).max(120).optional(),
      ageMax: z.number().min(18).max(120).optional(),
    })
    .optional(),
  privacy: z
    .object({
      showDistance: z.boolean().optional(),
    })
    .optional(),
});

export const photoModerationSchema = z.object({
  moderationStatus: z.enum(["approved", "rejected"]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PhotoModerationInput = z.infer<typeof photoModerationSchema>;