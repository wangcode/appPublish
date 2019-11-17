import mongoose from '../helper/db';

const Schema = mongoose.Schema;
// @ts-ignore
const ObjectId = Schema.ObjectId;

const userSchema = {
  username: {
    type: String,
    index: true
  },
  password: {
    type: String
  },
  email: {
    type: String,
    index: true
  },
  token: {
    type: String
  },
  apiToken: {
    type: String
  },
  teams: [{
    _id: ObjectId,
    name: String,
    icon: String,
    role: {
      type: String,
      enum: ["owner", "manager", "guest"]
    }
  }],
  mobile: String,
  qq: String,
  company: String,
  career: String
}

const User = mongoose.model('User', new Schema(userSchema))

export { User, userSchema }