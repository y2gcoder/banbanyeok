import type { Metadata } from "next";
import { CreateRoomForm } from "@/components/room/create-form";
import { newRoomMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = newRoomMetadata();

export default function Page() {
  return <CreateRoomForm />;
}
