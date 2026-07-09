import { z } from "zod";

/*
  Validation for the Customer Master form. GSTIN/PAN formats follow the
  standard GST/Income-Tax structures; the conditional rules (TDS, MSME,
  export) are enforced with superRefine since they depend on a sibling field.
*/

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export const REGISTRATION_TYPES = ["REGULAR", "COMPOSITION", "UNREGISTERED", "SEZ"] as const;
export const MSME_STATUSES = ["MICRO", "SMALL", "MEDIUM", "NA"] as const;
export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const;
export const EXPORT_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const customerFormSchema = z
  .object({
    code: z.string().trim().min(1, "Customer code is required"),
    name: z.string().trim().min(1, "Name is required"),
    gstin: optionalText.refine((v) => !v || GSTIN_REGEX.test(v), {
      message: "Enter a valid 15-character GSTIN",
    }),
    pan: optionalText.refine((v) => !v || PAN_REGEX.test(v), {
      message: "Enter a valid 10-character PAN (e.g. AABCS1111A)",
    }),
    registration_type: z.enum(REGISTRATION_TYPES),
    billing_address: z.string().trim().min(1, "Billing address is required"),
    shipping_address: optionalText,
    state: optionalText,
    state_code: optionalText,
    contact_person: optionalText,
    phone: optionalText,
    email: optionalText.refine((v) => !v || z.string().email().safeParse(v).success, {
      message: "Enter a valid email address",
    }),
    // Signed: positive = customer owes us (receivable), negative = we owe them (credit balance).
    opening_balance: z.coerce.number().default(0),
    credit_days: z.coerce.number().int().min(0, "Credit days can't be negative"),
    credit_limit: z.coerce.number().min(0, "Credit limit can't be negative"),

    place_of_supply: optionalText,
    tds_applicable: z.boolean(),
    tds_section: optionalText,
    tcs_applicable: z.boolean(),
    msme_status: z.enum(MSME_STATUSES),
    udyam_number: optionalText,
    bank_account_no: optionalText,
    bank_ifsc: optionalText,
    currency: z.string().trim().min(1).default("INR"),
    is_export_client: z.boolean(),
    lut_number: optionalText,
    status: z.enum(CUSTOMER_STATUSES),
    remarks: optionalText,
  })
  .superRefine((data, ctx) => {
    if (data.tds_applicable && !data.tds_section) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tds_section"],
        message: "TDS section is required when TDS is applicable",
      });
    }
    if (data.msme_status !== "NA" && !data.udyam_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["udyam_number"],
        message: "Udyam number is required for MSME customers",
      });
    }
    if (data.is_export_client && !data.lut_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lut_number"],
        message: "LUT number is required for export clients",
      });
    }
  });

export type CustomerFormValues = z.infer<typeof customerFormSchema>;
