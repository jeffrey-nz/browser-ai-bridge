export async function checkSnackbarError(snackbarLocator) {
  if (await snackbarLocator.isVisible({ timeout: 200 }).catch(() => false)) {
    const txt = await snackbarLocator.innerText().catch(() => "");
    if (
      txt.toLowerCase().includes("something went wrong") ||
      txt.includes("(13)")
    ) {
      return "ERROR_13";
    }
  }
  return null;
}
