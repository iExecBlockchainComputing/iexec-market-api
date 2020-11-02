const io = require("socket.io-client");

const API_BASE_URL = "http://localhost:3000";

const ws = io(API_BASE_URL, { path: "/ws" });

ws.on("connect", () => console.log("connect", API_BASE_URL));
ws.on("disconnect", () => console.log("disconnect", API_BASE_URL));
ws.on("connect_error", error => console.log("connect_error: ", error));
ws.on("connect_timeout", () => console.log("connect_timeout"));
ws.on("error", error => console.log("error: ", error));
ws.on("reconnect", attempt => console.log("reconnect: ", attempt));
ws.on("reconnect_attempt", attempt => console.log("reconnect_attempt: ", attempt));
ws.on("reconnecting", attempt => console.log("reconnecting: ", attempt));
ws.on("reconnect_error", error => console.log("reconnect_error: ", error));
ws.on("reconnect_failed", () => console.log("reconnect_failed"));

ws.emit(
  "join",
  {
    chainId: "5",
    topic: "orders"
  },
  joinACK => {
    ws.on("apporder_published", message => {
      console.log("apporder_published", message);
    });
    ws.on("datasetorder_published", message => {
      console.log("datasetorder_published", message);
    });
    ws.on("workerpoolorder_published", message => {
      console.log("workerpoolorder_published", message);
    });
    ws.on("requestorder_published", message => {
      console.log("requestorder_published", message);
    });
    ws.on("apporder_unpublished", message => {
      console.log("apporder_unpublished", message);
    });
    ws.on("datasetorder_unpublished", message => {
      console.log("datasetorder_unpublished", message);
    });
    ws.on("workerpoolorder_unpublished", message => {
      console.log("workerpoolorder_unpublished", message);
    });
    ws.on("requestorder_unpublished", message => {
      console.log("requestorder_unpublished", message);
    });
  }
);
ws.emit(
  "join",
  {
    chainId: "5",
    topic: "deals"
  },
  joinACK => {
    ws.on("deal_created", message => {
      console.log("deal_created", message);
    });
  }
);
