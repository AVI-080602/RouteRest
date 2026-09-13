import StateCheckForm from "@/components/StateCheckForm";

export default function StateCheckPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <StateCheckForm context="pre-departure" />
    </main>
  );
}
