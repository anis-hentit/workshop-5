import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";
import { NodeState } from "../types";

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();


  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });
  let currentState: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };

  // this route starts the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      currentState.k = 1;
      currentState.x = initialValue;
      currentState.decided = false;
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            k: currentState.k,
            x: currentState.x,
            type: "2P",
          }),
        });
      }
    } else {
      currentState.decided = null;
      currentState.x = null;
      currentState.k = null;
    }
    res.status(200).send("success");
  });

  // this route allows the node to receive messages from other nodes
  node.post("/message", async (req, res) => {
    let { k, x, type } = req.body;
    if (!currentState.killed && !isFaulty) {
      if (type == "2P") {
        if (!proposals.has(k)) proposals.set(k, []);
        proposals.get(k)!.push(x);
        const proposal = proposals.get(k)!;
        if (proposal.length >= N - F) {
          const CN = proposal.filter((x) => x == 0).length;
          const CY = proposal.filter((x) => x == 1).length;
          x = CN > N / 2 ? 0 : CY > N / 2 ? 1 : "?";
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ k, x, type: "2V" }),
            });
          }
        }
      } else if (type == "2V") {
        if (!votes.has(k)) votes.set(k, []);
        votes.get(k)!.push(x);
        const vote = votes.get(k)!;
        if (vote.length >= N - F) {
          const CN = vote.filter((x) => x == 0).length;
          const CY = vote.filter((x) => x == 1).length;
          if (CN >= F + 1) {
            currentState.x = 0;
            currentState.decided = true;
          } else if (CY >= F + 1) {
            currentState.x = 1;
            currentState.decided = true;
          } else {
            currentState.x = CN + CY > 0 && CN > CY ? 0 : CN + CY > 0 && CN < CY ? 1 : Math.random() > 0.5 ? 0 : 1;
            currentState.k = k + 1;
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k: currentState.k, x: currentState.x, type: "2P" }),
              });
            }
          }
        }
      }
    }
    res.status(200).send("success");
  });


  // this route stops the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentState.killed = true;
    currentState.x = null;
    currentState.decided = null;
    currentState.k = 0;
    res.send("Node stopped");
  });


  // this route returns the current state of the node
  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.send({
        killed: currentState.killed,
        x: null,
        decided: null,
        k: null,
      });
    } else {
      res.send(currentState);
    }
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
        `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}