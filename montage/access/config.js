// Настройки доступа к Монтажке. Заполняются один раз — по инструкции montage/ACCESS.md.
export default {
  // Firebase → ⚙️ Project settings → General → Your apps → объект firebaseConfig
  firebase: {
    apiKey:      "",
    authDomain:  "",
    databaseURL: "",
    projectId:   "",
    appId:       ""
  },
  // Ссылка на кнопке «Купить» (магазин, Telegram, форма оплаты). Пусто — кнопки не будет.
  buyUrl: "",
  // Куда писать, если что-то не так (email или @telegram). Пусто — строка не покажется.
  contact: ""
};
