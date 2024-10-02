export function idOfVertex(vertex) {
  return vertex['@rid'];
}

export function nameOfVertex(vertex) {
  let name = idOfVertex(vertex);

  if (vertex.type === 'API') {
    name = `${name} API ${vertex.name}`;
  } else if (vertex.category === 'component') {
    name = `${name} ${vertex.name} (${vertex.systemModule})`;
  } else {
    name = `${name} ${vertex.name}`;
  }

  return name;
}
