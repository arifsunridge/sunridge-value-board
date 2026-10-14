import { redirect } from "next/navigation";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";

export default async function Home() {
  const me = await requirePerson("/");
  const [first] = await board().companies(me);
  redirect(first ? `/c/${first.id}` : "/my");
}
