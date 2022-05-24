
// elements
const micToggle = document.getElementById("micToggle");
const headphoneToggle = document.getElementById("headphoneToggle");
const settingsToggle = document.getElementById("settingsToggle");
const server1 = document.getElementById("server1");
const voice1 = document.getElementById("voice1");
const sendButton = document.getElementById("sendText");

const roomName = "room1"

const localAudio = document.getElementById("localAudio");

const config = require('./config');
const mediasoup = require('mediasoup-client')
const socketClient = require('socket.io-client');
const { DataProducer } = require('mediasoup-client/lib/DataProducer');
const socketPromise = require('./lib/socket.io-promise').promise;

let device
let socket
let rtpCapabilities
let dataChannelProducer
let producer
let connectedProducerIds = [];
let audioEnabled = false;
let params = {
    codecOptions:
    {
        opusStereo: 1,
        opusDtx: 1
    }
}
let textInput;

const opts = {
  path: '/server',
  transports: ['websocket'],
};

const hostname = window.location.hostname;
const serverUrl = `https://${hostname}:${config.listenPort}`;
socket = socketClient(serverUrl, opts);
socket.request = socketPromise(socket);


function connectToServer(){
  socket.on('connect', async () => {
    console.log("Connected to the server with id = " + socket.id)
  
    const data = await socket.request('getRouterRtpCapabilities');
    await loadDevice(data);
    initializeDataChannel();
  
  });
  
  socket.on('newProducer', async ( producerId) => {
    console.log("Producer available id = " + producerId)
    const newElem = document.createElement('div')
    newElem.setAttribute('id', `td-${producerId}`)
  
    //append to the audio container
    newElem.innerHTML = '<p id="p' + producerId + '" >'+producerId+'</p>'
    participantContainer.appendChild(newElem)
    document.getElementById('p'+producerId)
  
    subscribe( producerId )
    
  });

  socket.on('newChannelProducer', async ( producerId) => {
    console.log("Producer available id = " + producerId)
    subcribeToDataChannel(producerId)
    //subscribe( producerId )
    
  });
  
  socket.on('producerClosed', id => {
    console.log("Producer closed event fired")
  
    document.getElementById("p" + id).innerHTML = '';
  });  
}



async function loadDevice(routerRtpCapabilities) {
  try {
    device = new mediasoup.Device();
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.error('browser not supported');
    }
  }
  await device.load({ routerRtpCapabilities });
}

async function initializeDataChannel(){
  console.log("Initializing data channel")
  const data = await socket.request('createDataProducerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
    sctpCapabilities: device.sctpCapabilities,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }

  const transport = device.createSendTransport({...data, iceServers : [ {
    'urls' : 'stun:stun1.l.google.com:19302'
  }]});

  transport.on('connect', async ({ dtlsParameters, sctpParameters }, callback, errback) => {
    console.log("Connected to the transport for data channel")
    socket.request('connectDataProducerTransport', { dtlsParameters, sctpParameters })
      .then(callback)
      .catch(errback);
  });

  transport.on('producedata', async ({ kind, rtpParameters,  }, callback, errback) => {
    try {
      const { id, producersExist } = await socket.request('producedata', {
        transportId: transport.id,
        kind,
        rtpParameters,
      });
      console.log("Producers exists on the server: " + producersExist)
      if (producersExist){
        getProducers()
      }
      callback({ id });
    } catch (err) {
      errback(err);
    }
  });

  dataChannelProducer = transport.produceData()

}

function sendMessage(){
  console.log("Sending message to the server")
  let message = document.getElementById("chatInput").value

  dataChannelProducer.then((produce)=>{
    produce.send(message);

    const chat = document.getElementById('chatWindow')

    const newElem = document.createElement('div')
  
    //append to the audio container
    newElem.innerHTML = '<article class="msg-container msg-self" id="msg-0"> \
                            <div class="msg-box"> \
                              <div class="flr"> \
                                  <div class="messages">\
                                      <p class="msg" id="msg-1">\
                                          ' + message + ' \
                                      </p> \
                                  </div> \
                                  <span class="timestamp"><span class="username">'+ produce.id +'</span>&bull;<span class="posttime">2 minutes ago</span></span> \
                              </div> \
                              <img class="user-img" id="user-0" src="//gravatar.com/avatar/56234674574535734573000000000001?d=retro" /> \
                            </div> \
                          </article>'
      
    chatWindow.appendChild(newElem)
  })

}
async function publish(e) {

  const data = await socket.request('createProducerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
    sctpCapabilities: device.sctpCapabilities,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }

  const transport = device.createSendTransport({...data, iceServers : [ {
    'urls' : 'stun:stun1.l.google.com:19302'
  }]});
  transport.on('connect', async ({ dtlsParameters, sctpParameters }, callback, errback) => {
    socket.request('connectProducerTransport', { dtlsParameters, sctpParameters })
      .then(callback)
      .catch(errback);
  });

  transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    console.log("Produce emitted for audio transport")
    try {
      const { id, producersExist } = await socket.request('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
      });
      console.log("Producers exists on the server: " + producersExist)
      audioEnabled = true
      if (producersExist){
        getProducers()
      }
      callback({ id });
    } catch (err) {
      errback(err);
    }
  });

  transport.on('connectionstatechange', (state) => {
    switch (state) {
      case 'connecting':
        console.log("Connecting to publish")
      break;  audioEnabled = true


      case 'connected':
        console.log("Connected")
      break;

      case 'failed':
        transport.close();
        console.log("Failed connection")
      break;

      default: break;
    }
  });

  let stream;

  const mediaConstraints = {
    audio: true,
    video: false
  }

  try {
     navigator.mediaDevices.getUserMedia(mediaConstraints).then( (stream) => {
      const newElem = document.createElement('div')
      newElem.setAttribute('id', `localAudio`)

      //append to the audio container
      newElem.innerHTML = '<audio id="localAudio" autoplay></audio>'
    
      videoContainer.appendChild(newElem)
      document.getElementById("localAudio").srcObject = stream;
      const track = stream.getAudioTracks()[0];
      let params = { track };
  
      params.codecOptions = {
        opusStereo: 1,
        opusDtx: 1
      }
      producer = transport.produce(params);
     })
  } catch (err) {
    alert(err);
  }
}

function closeProducer(){
  if(audioEnabled){
  producer.then((produce)=>{ 
      console.log("CLOSING PRODUCER")
      let id = produce.id;
      socket.request('producerClose', { id });
      produce.close()
    })
  }
  //initializeDataChannel()
}

async function subscribe(remoteProducerId) {
  console.log("Subscribing to the producer for audio = " + remoteProducerId)
  const data = await socket.request('createConsumerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
    sctpCapabilities: device.sctpCapabilities,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }
  console.log("Created consumer transport with id")

  const transport = device.createRecvTransport({...data, iceServers : [ {
    'urls' : 'stun:stun1.l.google.com:19302'
  }]});

  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    console.log("Connected to the transport")
    socket.request('connectConsumerTransport', {
      transportId: transport.id,
      dtlsParameters
    })
      .then(callback)
      .catch(errback);
  });

  transport.on('connectionstatechange', async (state) => {
    switch (state) {
      case 'connecting':
        console.log("Connecting to consumer for audio, transport id: " + transport.id)
        break;

      case 'connected':
        //document.querySelector('#remoteVideo').srcObject = await stream;
        // create a new div element for the new consumer media
        const newElem = document.createElement('div')
        newElem.setAttribute('id', `td-${remoteProducerId}`)

        //append to the audio container
        newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
      
        videoContainer.appendChild(newElem)
        document.getElementById(remoteProducerId).srcObject = await stream;

        //await socket.request('resume');
        console.log("Connected to consumer for audio, transport id: " + transport.id)
        break;

      case 'failed':
        transport.close();
        console.log("Consumer failed")
        break;

      default: break;
    }
  });
  console.log("REMOTE PRODUCER ID = " + remoteProducerId)
  const stream = consume(transport, remoteProducerId)
}


async function subcribeToDataChannel(remoteProducerId) {
  console.log("Subscribing to the producer for dataChannel = " + remoteProducerId)
  const data = await socket.request('createDataConsumerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
    sctpCapabilities: device.sctpCapabilities,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }
  console.log("Created consumer transport with id")

  const transport = device.createRecvTransport({...data, iceServers : [ {
    'urls' : 'stun:stun1.l.google.com:19302'
  }]});
  
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    console.log("Connected to the data consumer transport")
    socket.request('connectDataConsumerTransport', {
      transportId: transport.id,
      dtlsParameters,
      dataChannel: true
    })
      .then(callback)
      .catch(errback);
  });
  transport.on('connectionstatechange', async (state) => {
    switch (state) {
      case 'connecting':
        console.log("Connecting to consumer for data transport = " + transport.id)
        break;

      case 'connected':
        //document.querySelector('#remoteVideo').srcObject = await stream;
        // create a new div element for the new consumer media
        console.log("Connected to consumer for data")
        connectedProducerIds.push(remoteProducerId)
        break;

      case 'failed':
        transport.close();
        console.log("Consumer failed")
        break;

      default: break;
    }
  });

  console.log("REMOTE PRODUCER ID = " + remoteProducerId)
  
  const stream = await consumeData(transport, remoteProducerId)
  stream.on('message', async (data) => {

    const chat = document.getElementById('chatWindow')

    const newElem = document.createElement('div')
  
    //append to the audio container
    newElem.innerHTML = '<article class="msg-container msg-remote" id="msg-1"> \
                            <div class="msg-box"> \
                            <img class="user-img" id="user-0" src="//gravatar.com/avatar/56234674574535734573000000000001?d=retro" /> \
                              <div class="flr"> \
                                <div class="messages"> \
                                      <p class="msg" id="msg-1">\
                                          ' + data + ' \
                                      </p> \
                                  </div> \
                                  <span class="timestamp"><span class="username">'+ remoteProducerId +'</span>&bull;<span class="posttime">2 minutes ago</span></span> \
                              </div> \
                            </div> \
                          </article>'
      
    chatWindow.appendChild(newElem)
  })
}

function getProducers(){
  socket.emit('getProducers', producerIds => {
    // for each of the producer create a consumer
    // producerIds.forEach(id => signalNewConsumerTransport(id))
    producerIds.forEach(id => {
      if(id[1] == true){
        console.log("DATA CHANNEL PRODUCER")

        if(!connectedProducerIds.includes(id[0])){
          subcribeToDataChannel(id[0])
        }
      }
      else if(id[1] == false && audioEnabled){
        subscribe(id[0])
        const newElem = document.createElement('div')
        newElem.setAttribute('id', `td-${id[0]}`)
  
        //append to the audio container
        newElem.innerHTML = '<p id="p' + id[0] + '" >'+id[0]+'</p>'
      
        participantContainer.appendChild(newElem)
        document.getElementById('p'+id[0])
      }
     
    })
  })
}
async function consumeData(transport, remoteProducerId) {
  console.log("Consume data for datachannel, producerId = " + remoteProducerId)
  const { sctpStreamParameters } = device;
  const transportId  = transport.id;
  const data = await socket.request('consumedata', { sctpStreamParameters, remoteProducerId, transportId, dataChannel:true });

  const {
    producerId,
    id,
    kind,
    sctpParameters,
  } = data;

  const consumer = await transport.consumeData({
    id: id,
    dataProducerId: remoteProducerId,
    sctpStreamParameters : {
      streamId : 0,
      ordered  : true
    },
  });

  return consumer;
}

async function consume(transport, remoteProducerId) {
  const { rtpCapabilities } = device;
  const transportId  = transport.id;

  console.log("Consume called for audio conference")
  const data = await socket.request('consume', { rtpCapabilities, remoteProducerId, transportId, dataChannel:false });
  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;

  let codecOptions = {};
  const consumer = await transport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions,
  });
  const stream = new MediaStream();
  stream.addTrack(consumer.track);
  return stream;
}


//No video app.
const mediaConstraints = {
    audio: true,
    video: false
}


voice1.addEventListener("click", publish)
connectToServer()
//server1.addEventListener("click", subscribe);

//sendButton.addEventListener("click",createSendDataTransport )

// mic unmuted svg
const MIC_UNMUTED = `<svg aria-hidden="false" viewBox="0 0 24 24" class="unmuted">
    <path fill-rule="evenodd" clip-rule="evenodd"
        d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1ZM12 4C11.2 4 11 4.66667 11 5V11C11 11.3333 11.2 12 12 12C12.8 12 13 11.3333 13 11V5C13 4.66667 12.8 4 12 4Z"
        ></path>
    <path fill-rule="evenodd" clip-rule="evenodd"
        d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V22H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z"
        ></path>
</svg>`;

// mic muted svg
const MIC_MUTED = `<svg aria-hidden="false" viewBox="0 0 24 24" class="muted">
    <path d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z"></path>
    <path
        d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z"
        ></path>
    <path
        d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.4978 17.633 10.747 17.6839 11 17.72V22H13V17.72C16.28 17.23 19 14.41 19 11H17.3C17.3 14 14.76 16.1 12 16.1C11.9076 16.1 11.8155 16.0975 11.7237 16.0927Z"
        ></path>
    <path d="M21 4.27L19.73 3L3 19.73L4.27 21L8.46 16.82L9.69 15.58L11.35 13.92L14.99 10.28L21 4.27Z"
        class="icon-strikethrough"></path>
</svg>`;

// undeaf svg
const UNDEAF = `<svg aria-hidden="false" viewBox="0 0 24 24" class="deafen">
    <svg width="24" height="24" viewBox="0 0 24 24">
        <path
            d="M12 2.00305C6.486 2.00305 2 6.48805 2 12.0031V20.0031C2 21.1071 2.895 22.0031 4 22.0031H6C7.104 22.0031 8 21.1071 8 20.0031V17.0031C8 15.8991 7.104 15.0031 6 15.0031H4V12.0031C4 7.59105 7.589 4.00305 12 4.00305C16.411 4.00305 20 7.59105 20 12.0031V15.0031H18C16.896 15.0031 16 15.8991 16 17.0031V20.0031C16 21.1071 16.896 22.0031 18 22.0031H20C21.104 22.0031 22 21.1071 22 20.0031V12.0031C22 6.48805 17.514 2.00305 12 2.00305Z"
            ></path>
    </svg>
</svg>`;

// deaf svg
const DEAF = `<svg aria-hidden="false" viewBox="0 0 24 24" class="undeafen">
    <path
        d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z"
        ></path>
    <path
        d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z"
        ></path>
    <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" class="icon-strikethrough"
        ></path>
</svg>`;

// settings svg
const CLOSE = `<svg aria-hidden="false" viewBox="0 0 24 24" class="settings">
    <path fill-rule="evenodd" clip-rule="evenodd"
        d="M 4.7070312 3.2929688 L 3.2929688 4.7070312 L 10.585938 12 L 3.2929688 19.292969 L 4.7070312 20.707031 L 12 13.414062 L 19.292969 20.707031 L 20.707031 19.292969 L 13.414062 12 L 20.707031 4.7070312 L 19.292969 3.2929688 L 12 10.585938 L 4.7070312 3.2929688 z">
    </path>
</svg>`;



// setup icon on ready
function setupIcon() {
  micToggle.innerHTML = MIC_UNMUTED;
  headphoneToggle.innerHTML = UNDEAF;
  closeToggle.innerHTML = CLOSE;
}

setupIcon();

micToggle.addEventListener("click", () => {
  if(audioEnabled){
    const stream = document.getElementById("localAudio").srcObject;

    if (micToggle.innerHTML.includes(`class="unmuted"`)){
      micToggle.innerHTML = MIC_MUTED;
      stream.getAudioTracks()[0].enabled = false;
    } 
    else{
      micToggle.innerHTML = MIC_UNMUTED;
      stream.getAudioTracks()[0].enabled = true;
    }
  }
});

headphoneToggle.addEventListener("click", () => {
  // just a test
  if (headphoneToggle.innerHTML.includes(`class="undeafen"`)) headphoneToggle.innerHTML = UNDEAF;
  else headphoneToggle.innerHTML = DEAF;
});

closeToggle.addEventListener("click", () => {
  closeProducer();
  if(audioEnabled){
    const stream = document.getElementById("localAudio").srcObject;
    stream.getTracks().forEach(function(track) {
      track.stop();
    });
  }
  audioEnabled = false;

  document.getElementById("participantContainer").innerHTML='';
})

sendButton.addEventListener("click", sendMessage);

