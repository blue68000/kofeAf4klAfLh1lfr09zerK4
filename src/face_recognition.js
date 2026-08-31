const GAS_URL = "https://script.google.com/macros/s/AKfycbxQTIKFDP9vv65GHl6Zjmir23U18Av1hC9JlDqo8xePSHwfvLxMDmHac4cwRYhDo1ae/exec";

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');
const nameInput = document.getElementById('name-input');
const regBtn = document.getElementById('reg-btn');
const resultMessage = document.getElementById('result-message');

let registeredFaces = []; // GASから読み込んだ登録済み顔データ
let currentUnregisteredDescriptor = null; // 現在検知中の未登録顔の特徴量

// GASから登録済み顔データをロード（CORS回避・text/plain版）
async function loadRegisteredData() {
  statusText.innerText = "スプレッドシートから顔データを読み込み中...";
  try {
    const payload = {
      "method": "READ DATAS",
      "sheetName": "顔認識テスト",
      "query": ""
    };

    const res = await fetch(GAS_URL, {
      method: "POST",
      // CORSエラーを回避するため text/plain を指定する
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });

    const responseObj = await res.json();
    console.log("GASからのレスポンス全体:", responseObj);

    let dataArray = responseObj.data;
    if (typeof dataArray === 'string') {
      dataArray = JSON.parse(dataArray);
    }

    if (Array.isArray(dataArray)) {
      registeredFaces = dataArray
        .filter(item => item.label && item.value)
        .map(item => {
          let rawVector = item.value;
          if (typeof rawVector === 'string') {
            rawVector = JSON.parse(rawVector);
          }

          return {
            label: item.label,
            descriptor: new Float32Array(rawVector)
          };
        });
    }

    statusText.innerText = `準備完了！（登録済み: ${registeredFaces.length}件）`;
  } catch (e) {
    console.error(e);
    statusText.innerText = "GASからのデータ読み込みに失敗しました（コンソールを確認してください）";
  }
}

// 2. スマホ・PCのカメラ起動
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 640, height: 480 },
    audio: false
  });
  video.srcObject = stream;
  return new Promise(resolve => video.onloadedmetadata = () => resolve());
}

// 3. リアルタイム検知＆照合ループ
async function detectFrame() {
  // videoの解像度が取れていない場合は処理をスキップ
  if (!video.videoWidth || !video.videoHeight) {
    requestAnimationFrame(detectFrame);
    return;
  }

  // Canvasサイズをビデオの実サイズに合わせる
  if (canvas.width !== video.videoWidth) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  try {
    const detections = await faceapi.detectAllFaces(video)
      .withFaceLandmarks()
      .withFaceDescriptors();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let hasUnregisteredInFrame = false;
    let detectedNames = [];

    detections.forEach(detection => {
      const { x, y, width, height } = detection.detection.box;
      const inputDescriptor = detection.descriptor;

      let bestMatch = { label: "人", distance: 1.0 };

      // 照合処理
      registeredFaces.forEach(known => {
        const distance = faceapi.euclideanDistance(inputDescriptor, known.descriptor);
        // しきい値0.5以下なら一致と判定
        if (distance < 0.5 && distance < bestMatch.distance) {
          bestMatch = { label: known.label, distance };
        }
      });

      if (bestMatch.label === "人") {
        currentUnregisteredDescriptor = inputDescriptor;
        hasUnregisteredInFrame = true;
        detectedNames.push("未登録の人");
      } else {
        // 一致した場合
        detectedNames.push(`${bestMatch.label}来たやん！`);
      }

      // 枠線の描画（赤：未登録 / 緑：登録済み）
      ctx.strokeStyle = bestMatch.label === "人" ? "#ff0055" : "#00ffcc";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, width, height);

      // 枠の上の文字描画
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = "bold 22px sans-serif";
      const displayText = bestMatch.label === "人" ? "人" : `${bestMatch.label}来たやん！`;
      ctx.fillText(displayText, x, y > 30 ? y - 10 : y + 30);
    });

    // 画面中央の大きなメッセージ枠に文字を表示！
    if (detectedNames.length > 0) {
      resultMessage.innerText = detectedNames.join(" / ");
    } else {
      resultMessage.innerText = "顔を探しています...";
    }

    regBtn.disabled = !hasUnregisteredInFrame;

  } catch (err) {
    console.error("detectFrame error:", err);
  }

  requestAnimationFrame(detectFrame);
}

// 4. 新しい顔の登録処理（GASへPOST）
regBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name || !currentUnregisteredDescriptor) {
    alert("名前を入力し、カメラに未登録の顔を映してください。");
    return;
  }

  regBtn.disabled = true;
  statusText.innerText = `「${name}」をスプレッドシートに保存中...`;

  // 128次元の数値配列を JSON 文字列化
  const descriptorArray = Array.from(currentUnregisteredDescriptor);
  
  const payload = {
    method: "WRITE SHEET",
    sheetName: "顔認識テスト",
    label: name,
    value: JSON.stringify(descriptorArray)
  };

  try {
    await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });

    // ローカルのデータ配列にも即時追加
    registeredFaces.push({
      label: name,
      descriptor: currentUnregisteredDescriptor
    });

    statusText.innerText = `「${name}」の登録が完了しました！`;
    nameInput.value = "";
  } catch (e) {
    console.error(e);
    statusText.innerText = "スプレッドシートへの保存に失敗しました。";
  }
});

// 5. メイン起動処理
async function main() {
  try {
    await setupCamera();
    
    // 軽量なモデルファイルをCDNからロード
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    statusText.innerText = '顔認識モデルをロード中...';
    
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);

    await loadRegisteredData();
    detectFrame();
  } catch (e) {
    console.error(e);
    statusText.innerText = '初期化エラー：カメラやネットワーク環境を確認してください。';
  }
}

main();

