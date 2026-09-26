// Настройки доступа к Монтажке. Заполняются один раз — по инструкции montage/ACCESS.md.
export default {
  // Firebase → ⚙️ Project settings → General → Your apps → объект firebaseConfig
  firebase: {
    apiKey:      "AIzaSyAWqiGdmhtWP42sg42IJKPD-NjkY0Jkp_A",
    authDomain:  "montaje-624fe.firebaseapp.com",
    databaseURL: "https://montaje-624fe-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:   "montaje-624fe",
    appId:       "1:720149763757:web:5fc0085ec38fabdeaa5824"
  },
  // Ссылка на кнопке «Купить» (магазин, Telegram, форма оплаты). Пусто — кнопки не будет.
  buyUrl: "",
  // Куда писать, если что-то не так (email или @telegram). Пусто — строка не покажется.
  contact: ""
};
