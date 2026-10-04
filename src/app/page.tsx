import { redirect } from "next/navigation";
import { board } from "@/server/context";
import { requireMember } from "@/server/session";

export default async function Home() {
  await requireMember("/");
  const [first] = await board().companies();
  redirect(first ? `/c/${first.id}` : "/my");
}
