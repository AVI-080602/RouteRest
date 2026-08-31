import Link from "next/link";
export default function Home() {
  return (
    <div className="container mx-auto px-4">
      <div className="flex flex-col justify-center items-center h-screen">
        <h1 className="text-4xl font-bold text-center">RouteRest</h1>
        <p className="text-lg text-center mt-4">
          Welcome to RouteRest, your route planning companion!
        </p>
        <div className="flex w-full mt-10">
          <Link
            href="/newjourney"
            className="inline-flex w-full justify-center items-center bg-yellow-500 font-semibold text-black px-4 py-4 rounded transition active:bg-yellow-600"
          >
            Plan My Journey
          </Link>
        </div>
        <div className="mb-16"></div>
      </div>
    </div>
  );
}
