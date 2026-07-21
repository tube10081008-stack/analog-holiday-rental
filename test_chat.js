import handler from "./api/chat.js";

const req = {
  method: "POST",
  body: JSON.stringify({ message: "예약하고 싶어요" }),
};
const res = {
  status: (code) => ({
    setHeader: () => {},
    send: (payload) => console.log(code, payload),
  }),
  setHeader: () => {},
  send: (payload) => console.log(200, payload),
};

handler(req, res).catch(console.error);
