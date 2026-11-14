import type { Metadata } from "next";
import { CreateRoomForm } from "@/components/room/create-form";
import { roomLinkMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = roomLinkMetadata();

export default function Page() {
  return <CreateRoomForm />;
}
