const URL = "https://analog-holiday-mall.vercel.app/api/agent-brain?action=self-study&agent=hani&key=eugene1004";

async function run() {
  console.log("Calling Vercel Endpoint:", URL);
  try {
    const res = await fetch(URL);
    const json = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(json, null, 2));
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

run();
