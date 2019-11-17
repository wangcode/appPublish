import mongoose from '../helper/db'

const Schema = mongoose.Schema
// @ts-ignore
const ObjectId = Schema.ObjectId

const teamSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  icon: String,
  creatorId: {
    type: String,
    required: true
  },
  createAt: {
    type: Date,
    default: Date.now
  },
  members: [
    {
      _id: ObjectId,
      username: String,
      email:String,
      role: {
        type: String,
        enum: ["owner", "manager", "guest"]
      }
    }
  ]
})

export default mongoose.model('Team', teamSchema);