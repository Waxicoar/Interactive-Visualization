d3.csv("temperature_projection.csv").then(data => {
  console.log(data);
});

const svg = d3.select("#chart")
  .append("svg")
  .attr("width", 800)
  .attr("height", 450);