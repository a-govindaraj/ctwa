import { defaultMembershipFees } from "./billing.js";

export const defaultSettings = {
  year: "2026-27",
  start: "2026-09-01",
  end: "2027-08-31",
  feesConfigured: false,
  membershipFees: { ...defaultMembershipFees },
  subjects: [
    "Tamil Language",
    "Bharathanatiyam",
    "Vocal Music",
    "Keyboard",
    "Mirudangam",
    "Veena",
    "Violin",
    "Kuchipudi",
    "Key Stage 1",
    "Key Stage 2",
    "Key Stage 3",
  ].map((name, index) => ({
    id: `subject-${index + 1}`,
    name,
    price: 0,
    frequency: "annually",
    active: true,
  })),
};
