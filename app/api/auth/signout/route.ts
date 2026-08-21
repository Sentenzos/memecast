import { clearAdminSession } from "../../../admin-auth";
import { publicOrigin } from "../../../public-origin";

export async function GET(request: Request) {
  await clearAdminSession();
  return Response.redirect(new URL("/", publicOrigin(request)));
}
