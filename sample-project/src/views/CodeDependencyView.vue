<template>

  <div style="width: 1800px;">
    <h1>Code Dependency</h1>

    <el-form :model="form" label-width="auto" style="width: 100%">
      <el-row>
        <el-col :span="24">
          <el-form-item label="Direction">
            <el-radio-group v-model="form.direction">
              <el-radio value="descendants">Descendants</el-radio>
              <el-radio value="ancestors">Ancestors</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <el-form-item label="Category">
            <el-select v-model="form.category" placeholder="Category" style="width: 240px">
              <el-option v-for="item in categories" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="Micro-Service">
            <el-input v-model="form.microService" style="width: 240px" placeholder="Micro-Service" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="System Module">
            <el-input v-model="form.systemModule" style="width: 240px" placeholder="System Module" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="Name">
            <el-input v-model="form.name" style="width: 240px" placeholder="Name" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <el-form-item label="Dependency Type">
            <el-input v-model="form.dependencyType" style="width: 240px" placeholder="Function" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="Depth">
            <el-input-number v-model="form.depth" :min="0" :step="1" style="width: 240px" placeholder="0 means unlimited" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item>
        <el-button type="primary" @click="retrieve">Retrieve</el-button>
      </el-form-item>
    </el-form>

    <el-row>
      <el-col :span="24">
        <v-chart :option="graphOptions" style="width: 100%; height: 500px;" />
      </el-col>
      <!-- <el-col :span="1"></el-col>
      <el-col :span="11">
        <el-scrollbar height="400px">
          <el-card v-for="(c, index) in conversations" :key="index" style="margin-bottom: 10px">
            <template #header>
              <div class="card-header">
                <span style="font-weight: bold;">{{ capitalize(c.role) }}</span>
              </div>
            </template>
            <p class="text">
              <el-input v-model="c.content" style="width: 100%" :rows="3" type="textarea" />
            </p>
          </el-card>
        </el-scrollbar>
        <el-input v-model="question" style="width: 100%" :rows="3" type="textarea" placeholder="Please input" />
        <el-button type="primary" @click="ask" style="margin-top: 10px">Ask</el-button>
        <el-button @click="clearConversation" style="margin-top: 10px">Clear conversation</el-button>
      </el-col> -->
    </el-row>

    <el-dialog v-model="affectedComponentDialogVisible" title="Possibly affected Components" width="1200">
      <el-table :data="gridData" highlight-current-row @row-click="selectComponent">
        <el-table-column property="microService" label="Micro-Service" width="140" />
        <el-table-column property="type" label="Type" width="100" />
        <el-table-column property="systemModule" label="System Module" width="200" />
        <el-table-column property="name" label="Name" width="200" />
        <el-table-column property="description" label="Description" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import capitalize from 'lodash/capitalize';
import { ref, reactive } from 'vue';
import axios from 'axios';
import { use } from 'echarts/core';
import { SankeyChart, TreeChart } from 'echarts/charts';
import {
  TitleComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';
import { MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { getTreeOptions } from './tree.js';

use([
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  SankeyChart,
  TreeChart,
  CanvasRenderer
]);

const categories = [
  { value: 'component', label: 'Component' },
  { value: 'systemModule', label: 'System Module' }
]

const affectedComponentDialogVisible = ref(false)

const form = reactive({
  direction: 'ancestors',
  category: 'component',
  microService: 'dep-graph-builder',
  systemModule: '/graph/graph.service.js',
  name: 'getAncestors',
  dependencyType: 'Function',
  depth: 0
})

const graphData = {
  "nodes": [],
  "links": []
};

const graphOptions = ref(getTreeOptions(graphData, form.direction));

const conversations = ref([]);
const question = ref('');
const gridData = ref([]);

function setDefault(direction) {
  if (direction === 'ancestors') {
    form.systemModule = '/graph/graph.service.js';
    form.name = 'getAncestors';
  } else {
    form.systemModule = '/vertex/vertex.routes.js';
    form.name = 'get /vertex/';
  }
}

async function retrieve() {
  const response = await axios.get(`/api/graph/${form.direction}?category=${form.category}&name=${encodeURIComponent(form.name)}&systemModule=${encodeURIComponent(form.systemModule)}&microService=${encodeURIComponent(form.microService)}&dependencyType=${encodeURIComponent(form.dependencyType)}&depth=${form.depth}`)
  const newOptions = getTreeOptions(response.data, form.direction);
  // const newOptions = getSankeyOptions(response.data);

  graphOptions.value = newOptions;
}

async function ask() {
  const userQuestion = question.value;
  question.value = '';

  if (userQuestion) {
    conversations.value.push({
      role: 'user',
      content: userQuestion
    });
  }

  if (conversations.value.length > 1) {
    // Continue conversation which requires passing all history
    const response = await axios.post('/api/ai/chat', { messages: conversations.value });
    conversations.value.push({
      role: 'asistant',
      content: response.data.data
    });
  } else if (!form.name) {
    // Business question without component entry point
    const response = await axios.post('/api/ai/affected-from-business', { changeDescription: userQuestion });
    gridData.value = response.data.data;
    affectedComponentDialogVisible.value = true;
  } else {
    const data = {
      direction: form.direction,
      component: {
        category: form.category,
        name: form.name,
        systemModule: form.systemModule,
        microService: form.microService
      },
      changeDescription: question.value
    };

    const response = await axios.post('/api/ai/affected-from-component', data);
    conversations.value.push({
      role: 'asistant',
      content: response.data.data
    });
  }
}

async function selectComponent(selectVertex) {
  form.systemModule = selectVertex.systemModule;
  form.name = selectVertex.name;
  form.microService = selectVertex.microService;
  form.direction = 'descendants';

  affectedComponentDialogVisible.value = false;

  await retrieve();
  await ask();
}

function clearConversation() {
  conversations.value.length = 0;
}
</script>

<style>
@media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
}
</style>
