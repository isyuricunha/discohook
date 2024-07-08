import { ActionFunctionArgs, json } from "@remix-run/cloudflare";
import { ZodKofiDonationPayload } from "~/types/kofi";
import { zxParseForm } from "~/util/zod";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const verificationToken = context.env.KOFI_WEBHOOK_TOKEN;
  if (!verificationToken) {
    // Technically optional on ko-fi's side,
    // but there's no reason not to do this.
    throw new Error("Must provide KOFI_WEBHOOK_TOKEN");
  }

  const { data } = await zxParseForm(request, ZodKofiDonationPayload);
  if (data.verification_token !== verificationToken) {
    throw json({ message: "Invalid verification token." }, 403);
  }
  return null;
};
