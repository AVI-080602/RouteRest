import StateCheckForm from "@/components/StateCheckForm";

export default function StateCheckPage() {
  return (
    <main>
      {/* Let the form paint the full page background in either theme. */}
      <StateCheckForm context="pre-departure" />
    </main>
  );
}