import { extractLastMessage } from "../extract/index.js";
import { checkDomForErrors } from "./domChecks.js";
import { checkTextForErrors } from "./textChecks.js";

export async function validateAndExtractResponse(page) {
  const responseText = await extractLastMessage(page);

  const domError = await checkDomForErrors(page, responseText);
  if (domError) return domError;

  const textError = checkTextForErrors(responseText);
  if (textError) return textError;

  return { action: "success", text: responseText };
}
