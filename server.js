const mediasoup = require('mediasoup');
const fs = require('fs');
const https = require('https');
const express = require('express');
const socketIO = require('socket.io');
const config = require('./config');

// Global variables
let worker;
let webServer;
let socketServer;
let expressApp;
let producer;
let consumer;
let mediasoupRouter;

(async () => {
  try {
    await runExpressApp();
    await runWebServer();
    await runSocketServer();
    await runMediasoupWorker();
  } catch (err) {
    console.error(err);
  }
})();

const roomName = "room1"

let peers = {}          // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []  
let rooms = []
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []
let dataProducers = []
let dataConsumers = []
let sctpParameters = [];

async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use(express.static(__dirname + '/public'));

  expressApp.use((error, req, res, next) => {
    if (error) {
      console.warn('Express app error,', error.message);

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
}

async function runWebServer() {
  const { sslKey, sslCrt } = config;
  if (!fs.existsSync(sslKey) || !fs.existsSync(sslCrt)) {
    console.error('SSL files are not found. check your config.js file');
    process.exit(0);
  }
  const tls = {
    cert: fs.readFileSync(sslCrt),
    key: fs.readFileSync(sslKey),
  };
  webServer = https.createServer(tls, expressApp);
  webServer.on('error', (err) => {
    console.error('starting web server failed:', err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log('server is running');
      console.log(`open https://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  });
}

async function runSocketServer() {
  socketServer = socketIO(webServer, {
    serveClient: false,
    path: '/server',
    log: false,
  });

  socketServer.on('connection', (socket) => {

    peers[socket.id] = {
      socket,
      roomName,           // Name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: '',
        isAdmin: false,   // Is this Peer the Admin?
      }
    }

    console.log('client connected');

    socket.on('disconnect', () => {
      console.log('Client disconnected id = ' + socket.id);
      consumers = removeItems(consumers, socket.id, 'consumer')
      producers = removeItems(producers, socket.id, 'producer')
      transports = removeItems(transports, socket.id, 'transport')
    });

    socket.on('connect_error', (err) => {
      console.error('client connection error', err);
    });

    socket.on('getRouterRtpCapabilities', (data, callback) => {
      callback(mediasoupRouter.rtpCapabilities);
    });

    socket.on('createProducerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport(false);
        //producerTransport = transport;
        addTransport(transport, roomName, false, socket.id, false)
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    //Create dataTransport
    socket.on('createDataProducerTransport', async (data, callback) => {
      try {
        const { transport, params } = await createWebRtcTransport(true);
        addTransport(transport, roomName, false, socket.id, true)

        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    //Create dataTransport
    socket.on('createDataConsumerTransport', async (data, callback) => {
      try {
        console.log("Creating data consumer transport")
        const { transport, params } = await createWebRtcTransport(true);
        addTransport(transport, roomName, true, socket.id, true)
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('createConsumerTransport', async (data, callback) => {
      try {
        console.log("Creating consumer transport")
        const { transport, params } = await createWebRtcTransport(false);
        addTransport(transport, roomName, true, socket.id, false)
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('connectProducerTransport', async (data, callback) => {
      console.log("Connecting Producer Transport")
      await getTransport(socket.id, false).connect({ dtlsParameters: data.dtlsParameters, sctpParameters: data.sctpParameters });
      callback();
    });

    socket.on('connectDataProducerTransport', async (data, callback) => {
      console.log("Connecting Data Producer Transport")
      await getTransport(socket.id, true).connect({ dtlsParameters: data.dtlsParameters, sctpParameters: data.sctpParameters });
      callback();
    });

    socket.on('connectConsumerTransport', async (data, callback) => {
      console.log("Connecting Consumer Transport, incoming data below")
      console.log(data)
      const consumerTransport = transports.find(transportData => (
        transportData.consumer && transportData.transport.id == data.transportId && !data.dataChannel
      )).transport

      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('connectDataConsumerTransport', async (data, callback) => {
      console.log("Connecting Data Consumer Transport")
      const consumerTransport = transports.find(transportData => (
        transportData.consumer && transportData.transport.id == data.transportId && data.dataChannel
      )).transport

      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters, sctpParameters: data.sctpParameters });
      callback();
    });

    socket.on('produce', async (data, callback) => {
      const {kind, rtpParameters} = data;
      console.log("Starting the producer")
      producer = await getTransport(socket.id, false).produce({ kind, rtpParameters });

      //Close event for producer
      producer.on('transportclose', () => {
        console.log('transport for this producer closed ')
        producer.close()
      })

      callback({ id: producer.id, producersExist: producers.length>0 ? true : false });
      addProducer(producer, roomName, socket.id, false)
      informConsumers(roomName, socket.id, producer.id)
    });

    socket.on('producedata', async (data, callback) => {
      const {kind, rtpParameters} = data;
      console.log("ProduceData called")
      producer = await getTransport(socket.id, true).produceData({sctpStreamParameters :
        {
          streamId : 0,
          ordered  : true
        }
      });

      //Close event for producer
      producer.on('transportclose', () => {
        console.log('transport for this producer closed ')
        producer.close()
      })

      callback({ id: producer.id, producersExist: producers.length>0 ? true : false });
      addProducer(producer, roomName, socket.id, true)
      informDataChannelConsumers(roomName, socket.id, producer.id)
    });

    socket.on('consumedata', async (data, callback) => {
      console.log("Consume data call on the server side")
      callback(await createDataConsumer(data.sctpStreamParameters, data.remoteProducerId, data.transportId, socket.id, data.dataChannel));
    });

    socket.on('consume', async (data, callback) => {
      console.log("Consume call on the server side, data is below")

      callback(await createConsumer(data.rtpCapabilities, data.remoteProducerId, data.transportId, socket.id, data.dataChannel));
    });

    socket.on('resume', async (data, callback) => {
      await consumer.resume();
      callback();
    });

    socket.on('getProducers', callback => {
      //return all producer transports
      let producerList = []
      producers.forEach(producerData => {
        if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
          producerList = [...producerList,[producerData.producer.id, producerData.dataChannel]]
        }
      })
      // return the producer list back to the client
      callback(producerList)

    });

    socket.on('producerClose', async (data, callback) => {
      console.log("Closing the producer for = " + socket.id)
      producer = await getProducer(socket.id, false)

      producer.close()
      callback();
      consumers = removeItems(consumers, socket.id, 'consumer', false)
      producers = removeItems(producers, socket.id, 'producer', false)
      transports = removeItems(transports, socket.id, 'transport', false)
    });


  });
}
function removeItems(items, socketId, type, dataChannel){
  console.log("Removing = " + type )
  items.forEach(item => {
    if (item.socketId === socketId && item.dataChannel == dataChannel) {
      item[type].close()
    }
  })
  items = items.filter(item => item.socketId !== socketId)
  return items
}

//Not used, can be implemented for developing further
async function createRoom(roomName, socketId){
  //Implement
}

function getProducer(socketId, dataChannel){
  const [producerTransport] = producers.filter(producer => producer.socketId === socketId && producer.dataChannel === dataChannel)
  return producerTransport.producer
}

function addTransport(transport, roomName, consumer, socketId, dataChannel){
  console.log("Adding transport = " + transport + " consumer = " + consumer + " socket Id = " + socketId)
  transports = [
    ...transports,
    { socketId: socketId, transport, roomName, consumer, dataChannel }
  ]

  peers[socketId] = {
    ...peers[socketId],
    transports: [
      ...peers[socketId].transports,
      transport.id,
    ]
  }
}

function addProducer(producer, roomName, socketId, dataChannel){
  producers = [
    ...producers,
    { socketId: socketId, producer, roomName, dataChannel}
  ]

  peers[socketId] = {
    ...peers[socketId],
    producers: [
      ...peers[socketId].producers,
      producer.id,
      dataChannel,
    ]
  }
  console.log("Producer added")
}

async function informDataChannelConsumers(roomName, socketId, id){
  console.log(`just joined, id ${id} ${roomName}, ${socketId}`)
  // A new producer just joined
  // let all consumers to consume this producer
  producers.forEach(producerData => {
    if (producerData.socketId !== socketId && producerData.roomName === roomName && producerData.dataChannel) {
      const producerSocket = peers[producerData.socketId].socket
      console.log("Informing Data Channel Consumer")
      console.log(id)
      // use socket to send producer id to producer
      producerSocket.emit('newChannelProducer',  id )
    }
  })
}

async function informConsumers(roomName, socketId, id){
  console.log(`just joined, id ${id} ${roomName}, ${socketId}`)
  // A new producer just joined
  // let all consumers to consume this producer

  producers.forEach(producerData => {
    if (producerData.socketId !== socketId && producerData.roomName === roomName && !producerData.dataChannel) {
      const producerSocket = peers[producerData.socketId].socket
      console.log("Informing consumer id = " + id)

      // use socket to send producer id to producer
      producerSocket.emit('newProducer',  id )
    }
  })
}

function getTransport(socketId, isDataChannel){
  console.log("Getting transport with socketId = " + socketId + " and dataChannel = " + dataChannel)

  const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer && transport.dataChannel == isDataChannel)
  return producerTransport.transport
}

async function runMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;

  mediasoupRouter = await worker.createRouter({ mediaCodecs });
  rooms[roomName] = {
    router: mediasoupRouter,
  }
}

async function createWebRtcTransport(sctpEnabled) {
  const {
    maxIncomingBitrate,
    initialAvailableOutgoingBitrate
  } = config.mediasoup.webRtcTransport;

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableFp: true,
    enableSctp: sctpEnabled,
    initialAvailableOutgoingBitrate,
  });
  transport.on('dtlsstatechange', dtlsState => {
    if (dtlsState === 'closed') {
      console.log("Transport closed due to dtls change")
      transport.close()
    }
  })

  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
    }
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    },
  };
}

function addConsumer(consumer, roomName, socketId, dataChannel){
  // add the consumer to the consumers list
  consumers = [
    ...consumers,
    { socketId: socketId, consumer, roomName, dataChannel }
  ]

  // add the consumer id to the peers list
  peers[socketId] = {
    ...peers[socketId],
    consumers: [
      ...peers[socketId].consumers,
      consumer.id,
    ]
  }
}

async function createConsumer( rtpCapabilities,  remoteProducerId, serverConsumerTransportId, socketId, dataChannel) {

  const router = rooms[roomName].router
  console.log("Creating consumer for remote producerId = " + remoteProducerId)

  let consumerTransport = transports.find(transportData => (
    transportData.consumer && transportData.transport.id == serverConsumerTransportId && transportData.dataChannel == dataChannel
  )).transport

  if (!router.canConsume(
    {
      producerId: remoteProducerId,
      rtpCapabilities,
    })
  ) {
    console.error('can not consume');
    return;
  }
  try {
    consumer = await consumerTransport.consume({
      producerId: remoteProducerId,
      rtpCapabilities,
    });

    consumer.on('transportclose', () => {
      console.log('transport close from consumer')
    })

    consumer.on('producerclose', () => {
      console.log('producer of consumer closed')
      const producerSocket = peers[socketId].socket

      producerSocket.emit('producerClosed',remoteProducerId)

      consumerTransport.close([])
      transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
      consumer.close()
      consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
    })

    addConsumer(consumer, roomName, socketId,false)
  } catch (error) {
    console.error('consume failed', error);
    return;
  }

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: remoteProducerId,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}
async function createDataConsumer( sctpStreamParameters,  remoteProducerId, serverConsumerTransportId, socketId, dataChannel) {

  const router = rooms[roomName].router
  console.log("Creating data consumer for remote producerId = " + remoteProducerId)
  

  let consumerTransport = transports.find(transportData => (
    transportData.consumer && transportData.transport.id == serverConsumerTransportId && transportData.dataChannel == dataChannel
  )).transport

  try {
    consumer = await consumerTransport.consumeData({
      dataProducerId: remoteProducerId,
      sctpStreamParameters : {
        streamId : 0,
        ordered  : true
      },
    });

    consumer.on('transportclose', () => {
      console.log('transport close from consumer')
    })

    consumer.on('dataproducerclose', () => {
      console.log('producer of consumer closed')
      const producerSocket = peers[socketId].socket

      producerSocket.emit('dataProducerClosed',remoteProducerId)

      consumerTransport.close([])
      transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
      consumer.close()
      consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
    })

    addConsumer(consumer, roomName, socketId, true)
  } catch (error) {
    console.error('consume failed', error);
    return;
  }

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: remoteProducerId,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    sctpStreamParameters: consumer.sctpStreamParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}
