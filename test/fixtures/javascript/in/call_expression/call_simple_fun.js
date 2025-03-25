function innerFunction() {
    return 1;
}

function publicFunction() {
    return innerFunction();
}

module.exports = {
  publicFunction
};
