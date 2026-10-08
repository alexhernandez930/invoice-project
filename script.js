function saveName() {
  const name = document.getElementById("name").value;

  fetch("/save", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      name: name,
    }),
  })
    .then(function (response) {
      return response.text();
    })
    .then(function (message) {
      document.getElementById("message").innerHTML = message;
    });
}
